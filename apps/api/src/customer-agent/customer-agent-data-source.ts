import { NotFoundException } from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import type {
  BusinessRulesResult,
  CustomerAgentDataContext,
  CustomerAgentDataSource,
  CustomerAgentProduct,
  CustomerAgentSettings,
  EffectivePriceResult,
  KnowledgeSearchResult,
  ProductSearchResult,
  VariantAvailabilityResult,
} from '@ai-business/customer-agent';
import type { AgentSettingsService } from '../configuration/agent-settings.service.js';
import type {
  BusinessRuleService,
  PublishedBusinessRuleSetView,
} from '../configuration/business-rule.service.js';
import type { KnowledgeService } from '../configuration/knowledge.service.js';
import type { InventoryService } from '../inventory/inventory.service.js';
import type { ProductService, ProductView } from '../products/product.service.js';

interface RequestCustomerAgentDataSourceOptions {
  readonly identity: VerifiedIdentity;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly correlationId: string;
  readonly products: ProductService;
  readonly inventory: InventoryService;
  readonly rules: BusinessRuleService;
  readonly knowledge: KnowledgeService;
  readonly settings: AgentSettingsService;
  readonly now?: () => Date;
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('request_aborted');
}

function mapProduct(product: ProductView): CustomerAgentProduct {
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    description: product.description,
    customAttributes: product.customAttributes,
    variants: product.variants
      .filter((variant) => variant.status === 'active')
      .map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        name: variant.name,
        attributes: variant.attributes,
      })),
  };
}

function searchableTokens(query: string): readonly string[] {
  return Array.from(
    new Set(
      query
        .normalize('NFKC')
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3),
    ),
  )
    .sort((left, right) => right.length - left.length)
    .slice(0, 4);
}

function matchingRule(
  rules: readonly PublishedBusinessRuleSetView[],
  currency: string,
): PublishedBusinessRuleSetView | null {
  const matching = rules.filter((rule) => rule.published.policy.currency === currency);
  return (
    matching.find((rule) => rule.key === 'default-pricing') ??
    (matching.length === 1 ? (matching[0] ?? null) : null)
  );
}

export class RequestCustomerAgentDataSource implements CustomerAgentDataSource {
  readonly #options: RequestCustomerAgentDataSourceOptions;
  readonly #now: () => Date;

  constructor(options: RequestCustomerAgentDataSourceOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
  }

  #verify(context: CustomerAgentDataContext): void {
    assertActive(context.signal);
    if (
      context.tenantId !== this.#options.tenantId ||
      context.conversationId !== this.#options.conversationId ||
      context.correlationId !== this.#options.correlationId
    ) {
      throw new Error('customer_agent_context_mismatch');
    }
  }

  async getSettings(context: CustomerAgentDataContext): Promise<CustomerAgentSettings> {
    this.#verify(context);
    try {
      const settings = await this.#options.settings.published(
        this.#options.identity,
        this.#options.correlationId,
        this.#options.tenantId,
      );
      return {
        versionId: settings.id,
        version: settings.version,
        language: settings.language,
        tone: settings.tone,
      };
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
      return {
        versionId: null,
        version: 0,
        language: 'ar',
        tone: 'professional',
      };
    }
  }

  async searchProducts(
    context: CustomerAgentDataContext,
    input: { readonly query: string; readonly productId: string | null; readonly limit: number },
  ): Promise<ProductSearchResult> {
    this.#verify(context);
    if (input.productId) {
      const product = await this.#options.products.get(
        this.#options.identity,
        this.#options.correlationId,
        this.#options.tenantId,
        input.productId,
      );
      return {
        observedAt: this.#now().toISOString(),
        items: product.status === 'active' ? [mapProduct(product)] : [],
      };
    }
    const candidates = new Map<string, ProductView>();
    const queries = [input.query, ...searchableTokens(input.query)].filter(
      (query, index, all) => query.length > 0 && all.indexOf(query) === index,
    );
    for (const query of queries) {
      assertActive(context.signal);
      const found = await this.#options.products.search(
        this.#options.identity,
        this.#options.correlationId,
        this.#options.tenantId,
        { q: query.slice(0, 100), status: 'active', limit: input.limit },
      );
      for (const product of found) candidates.set(product.id, product);
      if (candidates.size >= input.limit) break;
    }
    return {
      observedAt: this.#now().toISOString(),
      items: Array.from(candidates.values()).slice(0, input.limit).map(mapProduct),
    };
  }

  async getVariantAvailability(
    context: CustomerAgentDataContext,
    input: { readonly variantId: string; readonly quantity: number },
  ): Promise<VariantAvailabilityResult> {
    this.#verify(context);
    const balances = await this.#options.inventory.listBalances(
      this.#options.identity,
      this.#options.correlationId,
      this.#options.tenantId,
      { variantId: input.variantId, limit: 100 },
    );
    const availableQuantity = balances.reduce((total, balance) => total + balance.available, 0);
    const observedAt =
      balances
        .map((balance) => balance.updatedAt)
        .sort()
        .at(-1) ?? this.#now().toISOString();
    return {
      variantId: input.variantId,
      requestedQuantity: input.quantity,
      availableQuantity,
      available: availableQuantity >= input.quantity,
      locationCount: balances.length,
      observedAt,
    };
  }

  async getEffectivePrice(
    context: CustomerAgentDataContext,
    input: { readonly productId: string; readonly variantId: string | null },
  ): Promise<EffectivePriceResult> {
    this.#verify(context);
    const product = await this.#options.products.get(
      this.#options.identity,
      this.#options.correlationId,
      this.#options.tenantId,
      input.productId,
    );
    if (product.status !== 'active') throw new NotFoundException('Active product not found.');
    const variant = input.variantId
      ? product.variants.find(
          (candidate) => candidate.id === input.variantId && candidate.status === 'active',
        )
      : null;
    if (input.variantId && !variant) throw new NotFoundException('Active variant not found.');
    const listPrice = variant?.priceOverride ?? product.basePrice;
    const rules = await this.#options.rules.listPublished(
      this.#options.identity,
      this.#options.correlationId,
      this.#options.tenantId,
    );
    const rule = matchingRule(rules, product.currency);
    if (!rule) {
      return {
        productId: product.id,
        variantId: variant?.id ?? null,
        amount: listPrice,
        currency: product.currency,
        source: 'catalog',
        rule: null,
        observedAt: this.#now().toISOString(),
      };
    }
    const decision = await this.#options.rules.evaluate(
      this.#options.identity,
      this.#options.correlationId,
      this.#options.tenantId,
      rule.id,
      {
        currency: product.currency,
        listPrice,
        requestedPrice: listPrice,
        productId: product.id,
        conversationId: this.#options.conversationId,
      },
    );
    return {
      productId: product.id,
      variantId: variant?.id ?? null,
      amount: decision.decidedPrice ?? decision.listPrice,
      currency: decision.currency,
      source: 'published_rule',
      rule: decision.rule,
      observedAt: decision.createdAt,
    };
  }

  async getBusinessRules(
    context: CustomerAgentDataContext,
    input: { readonly scope: 'pricing' | 'general' },
  ): Promise<BusinessRulesResult> {
    this.#verify(context);
    void input.scope;
    const rules = await this.#options.rules.listPublished(
      this.#options.identity,
      this.#options.correlationId,
      this.#options.tenantId,
    );
    return {
      rules: rules.map((rule) => ({
        ruleSetId: rule.id,
        key: rule.key,
        ruleVersionId: rule.published.id,
        version: rule.published.version,
        policy: rule.published.policy as unknown as Readonly<Record<string, unknown>>,
      })),
      observedAt: this.#now().toISOString(),
    };
  }

  async findKnowledge(
    context: CustomerAgentDataContext,
    input: { readonly query: string; readonly limit: number },
  ): Promise<KnowledgeSearchResult> {
    this.#verify(context);
    return this.#options.knowledge.searchPublished(
      this.#options.identity,
      this.#options.correlationId,
      this.#options.tenantId,
      { q: input.query, limit: input.limit },
    );
  }
}
