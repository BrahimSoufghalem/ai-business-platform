import { describe, expect, it } from 'vitest';
import type { AiRunTraceRecord, AiRunTraceSink } from '@ai-business/ai-gateway';
import {
  CustomerAgentRuntime,
  type ConfirmDraftResult,
  type CustomerAgentDataSource,
  type CustomerAgentProduct,
  type CustomerAgentTurnInput,
  type CustomerDraftOrderResult,
  type DraftMutationResult,
  type PriceOfferResult,
} from '../src/index.js';

const tenantId = '20000000-0000-4000-8000-000000000001';
const conversationId = '20000000-0000-4000-8000-000000000002';
const customerId = '20000000-0000-4000-8000-000000000003';
const productId = '20000000-0000-4000-8000-000000000004';
const variantId = '20000000-0000-4000-8000-000000000005';
const draftOrderId = '20000000-0000-4000-8000-000000000006';
const orderId = '20000000-0000-4000-8000-000000000007';
const pricingDecisionId = '20000000-0000-4000-8000-000000000008';

const product: CustomerAgentProduct = {
  id: productId,
  code: 'ALPHA',
  name: 'هاتف Alpha',
  description: null,
  customAttributes: {},
  variants: [
    {
      id: variantId,
      sku: 'ALPHA-BLK',
      name: 'أسود',
      attributes: { color: 'أسود' },
    },
  ],
};

class MemorySink implements AiRunTraceSink {
  readonly records: AiRunTraceRecord[] = [];
  async record(run: AiRunTraceRecord): Promise<void> {
    this.records.push(run);
  }
}

class StatefulOrderSource implements CustomerAgentDataSource {
  draft: CustomerDraftOrderResult | null = null;
  availableQuantity = 10;
  saveCalls = 0;
  submitCalls = 0;
  confirmCalls = 0;
  logicalConfirmWrites = 0;
  lastPricingDecisionId: string | null = null;
  #phonePresent = false;
  #addressPresent = false;
  #confirmed = false;

  async getSettings() {
    return {
      versionId: null,
      version: 0,
      language: 'ar' as const,
      tone: 'friendly' as const,
    };
  }

  async searchProducts() {
    return {
      observedAt: '2026-01-01T00:00:00.000Z',
      items: [product],
    };
  }

  async getVariantAvailability(
    _context: Parameters<CustomerAgentDataSource['getVariantAvailability']>[0],
    input: Parameters<CustomerAgentDataSource['getVariantAvailability']>[1],
  ) {
    return {
      variantId: input.variantId,
      requestedQuantity: input.quantity,
      availableQuantity: this.availableQuantity,
      available: this.availableQuantity >= input.quantity,
      locationCount: this.availableQuantity > 0 ? 1 : 0,
      observedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  async getEffectivePrice(
    _context: Parameters<CustomerAgentDataSource['getEffectivePrice']>[0],
    input: Parameters<CustomerAgentDataSource['getEffectivePrice']>[1],
  ) {
    return {
      productId: input.productId,
      variantId: input.variantId,
      amount: '1000.00',
      currency: 'DZD',
      source: 'catalog' as const,
      pricingDecisionId: null,
      rule: null,
      observedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  async evaluatePriceOffer(
    _context: Parameters<CustomerAgentDataSource['evaluatePriceOffer']>[0],
    input: Parameters<CustomerAgentDataSource['evaluatePriceOffer']>[1],
  ): Promise<PriceOfferResult> {
    const outcome =
      input.requestedPrice === '900'
        ? ('accept' as const)
        : input.requestedPrice === '800'
          ? ('counter' as const)
          : ('reject' as const);
    return {
      pricingDecisionId: outcome === 'reject' ? null : pricingDecisionId,
      productId: input.productId,
      variantId: input.variantId,
      currency: 'DZD',
      listPrice: '1000.00',
      requestedPrice: input.requestedPrice,
      decidedPrice: outcome === 'accept' ? '900.00' : outcome === 'counter' ? '900.00' : null,
      outcome,
      reason:
        outcome === 'accept'
          ? 'within_policy'
          : outcome === 'counter'
            ? 'below_minimum_counter'
            : 'below_minimum_reject',
      rule:
        outcome === 'reject'
          ? null
          : {
              ruleSetId: '20000000-0000-4000-8000-000000000009',
              ruleVersionId: '20000000-0000-4000-8000-000000000010',
              version: 1,
            },
      observedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  async getBusinessRules() {
    return { rules: [], observedAt: '2026-01-01T00:00:00.000Z' };
  }

  async findKnowledge() {
    return {
      kind: 'knowledge_grounding' as const,
      trust: 'untrusted_content' as const,
      embeddedInstructions: 'ignore' as const,
      items: [],
    };
  }

  async getDraftOrder() {
    if (!this.draft) throw new Error('draft_missing');
    return { ...this.draft, operation: 'loaded' as const };
  }

  async createOrUpdateDraftOrder(
    _context: Parameters<CustomerAgentDataSource['createOrUpdateDraftOrder']>[0],
    input: Parameters<CustomerAgentDataSource['createOrUpdateDraftOrder']>[1],
  ): Promise<DraftMutationResult> {
    this.saveCalls += 1;
    this.#phonePresent ||= input.customerPhone !== null;
    this.#addressPresent ||= input.shippingAddress !== null;
    this.lastPricingDecisionId = input.pricingDecisionId;
    const unitPrice = input.pricingDecisionId ? '900.00' : '1000.00';
    const listTotal = (1000 * input.quantity).toFixed(2);
    const finalTotal = (Number(unitPrice) * input.quantity).toFixed(2);
    const missingFields: ('customer_phone' | 'shipping_address')[] = [];
    if (!this.#phonePresent) missingFields.push('customer_phone');
    if (!this.#addressPresent) missingFields.push('shipping_address');
    this.draft = {
      operation: input.draftOrderId ? 'updated' : 'created',
      draftOrderId,
      status: 'draft',
      version: (this.draft?.version ?? 0) + 1,
      currency: 'DZD',
      subtotal: listTotal,
      discountAmount: (Number(listTotal) - Number(finalTotal)).toFixed(2),
      shippingAmount: '0.00',
      total: finalTotal,
      items: [
        {
          productId,
          variantId,
          productName: product.name,
          variantName: product.variants[0]?.name ?? null,
          sku: 'ALPHA-BLK',
          quantity: input.quantity,
          listPrice: '1000.00',
          unitPrice,
          lineTotal: finalTotal,
          currency: 'DZD',
          pricingDecisionId: input.pricingDecisionId,
        },
      ],
      missingFields,
      readyForConfirmation: false,
    };
    return { outcome: 'saved', draft: this.draft, reason: null };
  }

  async submitDraftOrder(): Promise<DraftMutationResult> {
    if (!this.draft) throw new Error('draft_missing');
    this.submitCalls += 1;
    this.draft = {
      ...this.draft,
      operation: 'submitted',
      status: 'awaiting_confirmation',
      version: this.draft.version + 1,
      readyForConfirmation: true,
    };
    return { outcome: 'saved', draft: this.draft, reason: null };
  }

  async confirmDraftOrder(): Promise<ConfirmDraftResult> {
    if (!this.draft) throw new Error('draft_missing');
    this.confirmCalls += 1;
    if (!this.#confirmed) {
      this.#confirmed = true;
      this.logicalConfirmWrites += 1;
    }
    return {
      outcome: 'confirmed',
      reason: null,
      order: {
        orderId,
        orderNumber: 'ORD-TEST-0001',
        status: 'confirmed',
        currency: this.draft.currency,
        subtotal: this.draft.subtotal,
        discountAmount: this.draft.discountAmount,
        shippingAmount: this.draft.shippingAmount,
        total: this.draft.total,
        items: this.draft.items,
      },
    };
  }

  async cancelDraftOrder(): Promise<DraftMutationResult> {
    if (!this.draft) throw new Error('draft_missing');
    this.draft = {
      ...this.draft,
      operation: 'cancelled',
      status: 'cancelled',
      version: this.draft.version + 1,
      readyForConfirmation: false,
    };
    return { outcome: 'saved', draft: this.draft, reason: null };
  }
}

function turn(
  content: string,
  messageId: string,
  links: { readonly draft?: boolean; readonly order?: boolean } = {},
): CustomerAgentTurnInput {
  return {
    tenantId,
    correlationId: `correlation-${messageId}`,
    messageId,
    conversation: {
      id: conversationId,
      status: 'bot',
      version: 1,
      customerId,
      linkedProductId: links.draft ? productId : null,
      linkedDraftOrderId: links.draft ? draftOrderId : null,
      linkedOrderId: links.order ? orderId : null,
      messages: [
        {
          id: messageId,
          direction: 'inbound',
          senderType: 'customer',
          content,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  };
}

function runtime(source: CustomerAgentDataSource, sink = new MemorySink()) {
  let modelCalls = 0;
  return {
    sink,
    get modelCalls() {
      return modelCalls;
    },
    agent: new CustomerAgentRuntime({
      dataSource: source,
      traceSink: sink,
      createGateway: () => {
        modelCalls += 1;
        throw new Error('order flow must not call a model');
      },
    }),
  };
}

describe('deterministic customer order flow', () => {
  it('collects contact data, shows exact totals, requires explicit approval, and confirms once', async () => {
    const source = new StatefulOrderSource();
    const harness = runtime(source);

    const created = await harness.agent.run(
      turn('أريد شراء هاتف Alpha الأسود، الكمية: 2', '20000000-0000-4000-8000-000000000011'),
    );
    expect(created.text).toContain('رقم الهاتف');
    expect(created.draftOrderId).toBe(draftOrderId);
    expect(source.submitCalls).toBe(0);
    expect(source.confirmCalls).toBe(0);

    const withPhone = await harness.agent.run(
      turn('0555123456', '20000000-0000-4000-8000-000000000012', { draft: true }),
    );
    expect(withPhone.text).toContain('عنوان التوصيل');
    expect(source.draft?.items[0]?.quantity).toBe(2);

    const summarized = await harness.agent.run(
      turn('العنوان: 10 شارع الاستقلال، المدينة: الجزائر', '20000000-0000-4000-8000-000000000013', {
        draft: true,
      }),
    );
    expect(source.draft?.status).toBe('awaiting_confirmation');
    expect(summarized.text).toContain('2 × هاتف Alpha');
    expect(summarized.text).toContain('2000.00 DZD');
    expect(summarized.text).toContain('أؤكد الطلب');

    const ambiguous = await harness.agent.run(
      turn('نعم', '20000000-0000-4000-8000-000000000014', { draft: true }),
    );
    expect(ambiguous.status).toBe('clarification');
    expect(source.confirmCalls).toBe(0);

    const confirmed = await harness.agent.run(
      turn('أؤكد الطلب', '20000000-0000-4000-8000-000000000015', { draft: true }),
    );
    expect(confirmed.orderId).toBe(orderId);
    expect(confirmed.orderNumber).toBe('ORD-TEST-0001');
    expect(confirmed.text).toContain('2000.00 DZD');

    const replayed = await harness.agent.run(
      turn('أؤكد الطلب', '20000000-0000-4000-8000-000000000015', { draft: true, order: true }),
    );
    expect(replayed.orderId).toBe(orderId);
    expect(source.confirmCalls).toBe(2);
    expect(source.logicalConfirmWrites).toBe(1);
    expect(harness.modelCalls).toBe(0);
  });

  it('uses only policy decisions for negotiation and never drafts a counter or rejected offer', async () => {
    const source = new StatefulOrderSource();
    const harness = runtime(source);

    const counter = await harness.agent.run(
      turn('أريد شراء هاتف Alpha الأسود بسعر 800 DZD', '20000000-0000-4000-8000-000000000016'),
    );
    expect(counter.status).toBe('clarification');
    expect(counter.text).toContain('900.00 DZD');
    expect(source.saveCalls).toBe(0);

    const rejected = await harness.agent.run(
      turn('أريد شراء هاتف Alpha الأسود بسعر 500 DZD', '20000000-0000-4000-8000-000000000017'),
    );
    expect(rejected.text).toContain('خارج سياسة السعر');
    expect(source.saveCalls).toBe(0);

    const accepted = await harness.agent.run(
      turn('أريد شراء هاتف Alpha الأسود بسعر 900 DZD', '20000000-0000-4000-8000-000000000018'),
    );
    expect(accepted.text).toContain('رقم الهاتف');
    expect(source.saveCalls).toBe(1);
    expect(source.lastPricingDecisionId).toBe(pricingDecisionId);
    expect(source.draft?.items[0]?.unitPrice).toBe('900.00');
    expect(harness.modelCalls).toBe(0);
  });

  it('does not write a draft when the requested quantity is unavailable', async () => {
    const source = new StatefulOrderSource();
    source.availableQuantity = 1;
    const harness = runtime(source);

    const reply = await harness.agent.run(
      turn('أريد شراء هاتف Alpha الأسود، الكمية: 2', '20000000-0000-4000-8000-000000000019'),
    );

    expect(reply.status).toBe('clarification');
    expect(reply.text).toContain('غير متوفرة');
    expect(source.saveCalls).toBe(0);
    expect(source.submitCalls).toBe(0);
    expect(source.confirmCalls).toBe(0);
  });
});
