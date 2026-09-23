import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { isExplicitOrderConfirmation } from '@ai-business/customer-agent';
import type {
  BusinessRulesResult,
  CustomerAgentDataContext,
  CustomerAgentDataSource,
  CustomerDraftOrderResult,
  CustomerAgentProduct,
  CustomerAgentSettings,
  ConfirmDraftResult,
  ConfirmedCustomerOrder,
  DraftMutationResult,
  EffectivePriceResult,
  KnowledgeSearchResult,
  PriceOfferResult,
  ProductSearchResult,
  VariantAvailabilityResult,
} from '@ai-business/customer-agent';
import type { AgentSettingsService } from '../configuration/agent-settings.service.js';
import type {
  BusinessRuleService,
  PublishedBusinessRuleSetView,
} from '../configuration/business-rule.service.js';
import type { KnowledgeService } from '../configuration/knowledge.service.js';
import type { ConversationService } from '../conversations/conversation.service.js';
import type { InventoryService } from '../inventory/inventory.service.js';
import type { DraftOrderView, OrderService, OrderView } from '../orders/order.service.js';
import type { ProductService, ProductView } from '../products/product.service.js';

interface RequestCustomerAgentDataSourceOptions {
  readonly identity: VerifiedIdentity;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly customerId: string;
  readonly correlationId: string;
  readonly conversations: ConversationService;
  readonly products: ProductService;
  readonly inventory: InventoryService;
  readonly orders: OrderService;
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

function hasCompleteAddress(address: Readonly<Record<string, unknown>> | null): boolean {
  return (
    address !== null &&
    typeof address.line1 === 'string' &&
    address.line1.trim().length > 0 &&
    typeof address.city === 'string' &&
    address.city.trim().length > 0 &&
    typeof address.countryCode === 'string' &&
    address.countryCode.trim().length === 2
  );
}

function mapDraft(
  draft: DraftOrderView,
  operation: CustomerDraftOrderResult['operation'],
): CustomerDraftOrderResult {
  const missingFields: ('customer_phone' | 'shipping_address')[] = [];
  if (!draft.customerPhone) missingFields.push('customer_phone');
  if (!hasCompleteAddress(draft.shippingAddress)) missingFields.push('shipping_address');
  return {
    operation,
    draftOrderId: draft.id,
    status: draft.status,
    version: draft.version,
    currency: draft.currency,
    subtotal: draft.subtotal,
    discountAmount: draft.discountAmount,
    shippingAmount: draft.shippingAmount,
    total: draft.total,
    items: draft.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      variantName: item.variantName,
      sku: item.sku,
      quantity: item.quantity,
      listPrice: item.listPrice,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      currency: item.currency,
      pricingDecisionId: item.pricingDecisionId,
    })),
    missingFields,
    readyForConfirmation: draft.status === 'awaiting_confirmation' && missingFields.length === 0,
  };
}

function mapOrder(order: OrderView): ConfirmedCustomerOrder {
  if (order.status !== 'confirmed') {
    throw new ConflictException('The linked order is not confirmed.');
  }
  return {
    orderId: order.id,
    orderNumber: order.number,
    status: 'confirmed',
    currency: order.currency,
    subtotal: order.subtotal,
    discountAmount: order.discountAmount,
    shippingAmount: order.shippingAmount,
    total: order.total,
    items: order.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      variantName: item.variantName,
      sku: item.sku,
      quantity: item.quantity,
      listPrice: item.listPrice,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      currency: item.currency,
      pricingDecisionId: item.pricingDecisionId,
    })),
  };
}

function exceptionMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return 'order_operation_failed';
}

function isOutOfStock(error: unknown): boolean {
  return (
    error instanceof ConflictException &&
    JSON.stringify(error.getResponse()).toLocaleLowerCase('en').includes('insufficient')
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

  async #loadConversation() {
    const conversation = await this.#options.conversations.get(
      this.#options.identity,
      this.#options.correlationId,
      this.#options.tenantId,
      this.#options.conversationId,
    );
    if (conversation.customer.id !== this.#options.customerId) {
      throw new ConflictException('Conversation customer changed.');
    }
    return conversation;
  }

  async #selectLocation(
    context: CustomerAgentDataContext,
    variantId: string,
    quantity: number,
    preferredLocationId: string | null,
  ): Promise<string | null> {
    assertActive(context.signal);
    const balances = await this.#options.inventory.listBalances(
      this.#options.identity,
      this.#options.correlationId,
      this.#options.tenantId,
      { variantId, limit: 100 },
    );
    const available = balances
      .filter((balance) => balance.available >= quantity)
      .sort((left, right) => right.available - left.available);
    return (
      available.find((balance) => balance.locationId === preferredLocationId)?.locationId ??
      available[0]?.locationId ??
      null
    );
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
        pricingDecisionId: null,
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
        variantId: variant?.id ?? null,
        conversationId: this.#options.conversationId,
      },
    );
    return {
      productId: product.id,
      variantId: variant?.id ?? null,
      amount: decision.decidedPrice ?? decision.listPrice,
      currency: decision.currency,
      source: 'published_rule',
      pricingDecisionId: decision.id,
      rule: decision.rule,
      observedAt: decision.createdAt,
    };
  }

  async evaluatePriceOffer(
    context: CustomerAgentDataContext,
    input: {
      readonly productId: string;
      readonly variantId: string;
      readonly requestedPrice: string;
    },
  ): Promise<PriceOfferResult> {
    this.#verify(context);
    const product = await this.#options.products.get(
      this.#options.identity,
      this.#options.correlationId,
      this.#options.tenantId,
      input.productId,
    );
    const variant = product.variants.find(
      (candidate) => candidate.id === input.variantId && candidate.status === 'active',
    );
    if (product.status !== 'active' || !variant) {
      throw new NotFoundException('Active product variant not found.');
    }
    const listPrice = variant.priceOverride ?? product.basePrice;
    const rules = await this.#options.rules.listPublished(
      this.#options.identity,
      this.#options.correlationId,
      this.#options.tenantId,
    );
    const rule = matchingRule(rules, product.currency);
    if (!rule) {
      return {
        pricingDecisionId: null,
        productId: product.id,
        variantId: variant.id,
        currency: product.currency,
        listPrice,
        requestedPrice: input.requestedPrice,
        decidedPrice: null,
        outcome: 'reject',
        reason: 'no_published_pricing_rule',
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
        requestedPrice: input.requestedPrice,
        productId: product.id,
        variantId: variant.id,
        conversationId: this.#options.conversationId,
      },
    );
    return {
      pricingDecisionId: decision.id,
      productId: product.id,
      variantId: variant.id,
      currency: decision.currency,
      listPrice: decision.listPrice,
      requestedPrice: decision.requestedPrice,
      decidedPrice: decision.decidedPrice,
      outcome: decision.outcome,
      reason: decision.reason,
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

  async getDraftOrder(
    context: CustomerAgentDataContext,
    input: { readonly draftOrderId: string },
  ): Promise<CustomerDraftOrderResult> {
    this.#verify(context);
    const conversation = await this.#loadConversation();
    if (conversation.draftOrderId !== input.draftOrderId) {
      throw new ConflictException('Draft order is not linked to this conversation.');
    }
    const draft = await this.#options.orders.getDraft(
      this.#options.identity,
      this.#options.correlationId,
      this.#options.tenantId,
      input.draftOrderId,
    );
    return mapDraft(draft, 'loaded');
  }

  async createOrUpdateDraftOrder(
    context: CustomerAgentDataContext,
    input: {
      readonly draftOrderId: string | null;
      readonly expectedVersion: number | null;
      readonly variantId: string;
      readonly quantity: number;
      readonly pricingDecisionId: string | null;
      readonly customerPhone: string | null;
      readonly shippingAddress: {
        readonly line1: string;
        readonly line2: string | null;
        readonly city: string;
        readonly region: string | null;
        readonly postalCode: string | null;
        readonly countryCode: string;
      } | null;
    },
  ): Promise<DraftMutationResult> {
    this.#verify(context);
    const conversation = await this.#loadConversation();
    let current: DraftOrderView | null = null;
    if (input.draftOrderId) {
      if (conversation.draftOrderId !== input.draftOrderId) {
        return { outcome: 'stale', draft: null, reason: 'conversation_draft_changed' };
      }
      current = await this.#options.orders.getDraft(
        this.#options.identity,
        this.#options.correlationId,
        this.#options.tenantId,
        input.draftOrderId,
      );
    } else if (conversation.draftOrderId) {
      const linked = await this.#options.orders.getDraft(
        this.#options.identity,
        this.#options.correlationId,
        this.#options.tenantId,
        conversation.draftOrderId,
      );
      if (linked.status !== 'cancelled' && linked.status !== 'confirmed') {
        return { outcome: 'stale', draft: null, reason: 'active_draft_already_exists' };
      }
    }
    const currentItem = current?.items[0] ?? null;
    const locationId = await this.#selectLocation(
      context,
      input.variantId,
      input.quantity,
      currentItem?.variantId === input.variantId ? currentItem.locationId : null,
    );
    if (!locationId) {
      return { outcome: 'out_of_stock', draft: null, reason: 'insufficient_stock' };
    }
    const pricingDecisionId =
      input.pricingDecisionId ??
      (currentItem?.variantId === input.variantId ? currentItem.pricingDecisionId : null);
    try {
      if (!input.draftOrderId) {
        const created = await this.#options.orders.createDraft(
          this.#options.identity,
          this.#options.correlationId,
          this.#options.tenantId,
          {
            customerId: this.#options.customerId,
            ...(input.customerPhone === null ? {} : { customerPhone: input.customerPhone }),
            ...(input.shippingAddress === null ? {} : { shippingAddress: input.shippingAddress }),
            customFields: {
              source: 'customer_agent',
              conversationId: this.#options.conversationId,
            },
            items: [
              {
                variantId: input.variantId,
                locationId,
                quantity: input.quantity,
                pricingDecisionId,
              },
            ],
          },
          this.#options.conversationId,
        );
        return { outcome: 'saved', draft: mapDraft(created, 'created'), reason: null };
      }
      if (input.expectedVersion === null || !current) {
        return { outcome: 'stale', draft: null, reason: 'draft_version_required' };
      }
      const updated = await this.#options.orders.updateDraft(
        this.#options.identity,
        this.#options.correlationId,
        this.#options.tenantId,
        input.draftOrderId,
        {
          expectedVersion: input.expectedVersion,
          ...(input.customerPhone === null ? {} : { customerPhone: input.customerPhone }),
          ...(input.shippingAddress === null ? {} : { shippingAddress: input.shippingAddress }),
          items: [
            {
              variantId: input.variantId,
              locationId,
              quantity: input.quantity,
              pricingDecisionId,
            },
          ],
        },
        this.#options.conversationId,
      );
      return { outcome: 'saved', draft: mapDraft(updated, 'updated'), reason: null };
    } catch (error) {
      if (isOutOfStock(error)) {
        return { outcome: 'out_of_stock', draft: null, reason: 'insufficient_stock' };
      }
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        return { outcome: 'stale', draft: null, reason: exceptionMessage(error) };
      }
      throw error;
    }
  }

  async submitDraftOrder(
    context: CustomerAgentDataContext,
    input: { readonly draftOrderId: string; readonly expectedVersion: number },
  ): Promise<DraftMutationResult> {
    this.#verify(context);
    const conversation = await this.#loadConversation();
    if (conversation.draftOrderId !== input.draftOrderId) {
      return { outcome: 'stale', draft: null, reason: 'conversation_draft_changed' };
    }
    const draft = await this.#options.orders.getDraft(
      this.#options.identity,
      this.#options.correlationId,
      this.#options.tenantId,
      input.draftOrderId,
    );
    for (const item of draft.items) {
      const locationId = await this.#selectLocation(
        context,
        item.variantId,
        item.quantity,
        item.locationId,
      );
      if (locationId !== item.locationId) {
        return { outcome: 'out_of_stock', draft: null, reason: 'draft_location_out_of_stock' };
      }
    }
    try {
      const submitted = await this.#options.orders.submitDraft(
        this.#options.identity,
        this.#options.correlationId,
        this.#options.tenantId,
        input.draftOrderId,
        { expectedVersion: input.expectedVersion },
      );
      return { outcome: 'saved', draft: mapDraft(submitted, 'submitted'), reason: null };
    } catch (error) {
      if (isOutOfStock(error)) {
        return { outcome: 'out_of_stock', draft: null, reason: 'insufficient_stock' };
      }
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        return { outcome: 'stale', draft: null, reason: exceptionMessage(error) };
      }
      throw error;
    }
  }

  async confirmDraftOrder(
    context: CustomerAgentDataContext,
    input: {
      readonly draftOrderId: string;
      readonly expectedVersion: number;
      readonly approvalMessageId: string;
      readonly customerApproved: true;
    },
  ): Promise<ConfirmDraftResult> {
    this.#verify(context);
    const conversation = await this.#loadConversation();
    if (conversation.draftOrderId !== input.draftOrderId) {
      return { outcome: 'stale', order: null, reason: 'conversation_draft_changed' };
    }
    const approval = conversation.messages.find(
      (message) =>
        message.id === input.approvalMessageId &&
        message.direction === 'inbound' &&
        message.senderType === 'customer',
    );
    if (!input.customerApproved || !approval || !isExplicitOrderConfirmation(approval.content)) {
      return { outcome: 'invalid_state', order: null, reason: 'explicit_approval_required' };
    }
    if (conversation.orderId) {
      const existing = await this.#options.orders.getOrder(
        this.#options.identity,
        this.#options.correlationId,
        this.#options.tenantId,
        conversation.orderId,
      );
      if (existing.sourceDraftOrderId !== input.draftOrderId) {
        return { outcome: 'stale', order: null, reason: 'linked_order_draft_mismatch' };
      }
      return { outcome: 'confirmed', order: mapOrder(existing), reason: null };
    }
    try {
      const order = await this.#options.orders.confirmDraft(
        this.#options.identity,
        this.#options.correlationId,
        this.#options.tenantId,
        input.draftOrderId,
        {
          expectedVersion: input.expectedVersion,
          customerApproved: true,
          approvalSource: 'customer_message',
          idempotencyKey: `agent-confirm:${this.#options.conversationId}:${input.approvalMessageId}`,
        },
        this.#options.conversationId,
      );
      return { outcome: 'confirmed', order: mapOrder(order), reason: null };
    } catch (error) {
      if (isOutOfStock(error)) {
        return { outcome: 'out_of_stock', order: null, reason: 'insufficient_stock' };
      }
      if (error instanceof BadRequestException) {
        return { outcome: 'invalid_state', order: null, reason: exceptionMessage(error) };
      }
      if (error instanceof ConflictException) {
        return { outcome: 'stale', order: null, reason: exceptionMessage(error) };
      }
      throw error;
    }
  }

  async cancelDraftOrder(
    context: CustomerAgentDataContext,
    input: {
      readonly draftOrderId: string;
      readonly expectedVersion: number;
      readonly reason: string;
    },
  ): Promise<DraftMutationResult> {
    this.#verify(context);
    const conversation = await this.#loadConversation();
    if (conversation.draftOrderId !== input.draftOrderId) {
      return { outcome: 'stale', draft: null, reason: 'conversation_draft_changed' };
    }
    try {
      const cancelled = await this.#options.orders.cancelDraft(
        this.#options.identity,
        this.#options.correlationId,
        this.#options.tenantId,
        input.draftOrderId,
        { expectedVersion: input.expectedVersion, reason: input.reason },
      );
      return { outcome: 'saved', draft: mapDraft(cancelled, 'cancelled'), reason: null };
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        return { outcome: 'stale', draft: null, reason: exceptionMessage(error) };
      }
      throw error;
    }
  }
}
