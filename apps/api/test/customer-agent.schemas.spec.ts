import { describe, expect, it } from 'vitest';
import {
  customerAgentReplyRequestSchema,
  storedCustomerAgentReplySchema,
} from '../src/customer-agent/customer-agent.schemas.js';

const id = '10000000-0000-4000-8000-000000000001';

describe('customer-agent API schemas', () => {
  it('requires one strict inbound message reference', () => {
    expect(customerAgentReplyRequestSchema.parse({ messageId: id })).toEqual({
      messageId: id,
    });
    expect(customerAgentReplyRequestSchema.safeParse({ messageId: id, tenantId: id }).success).toBe(
      false,
    );
    expect(customerAgentReplyRequestSchema.safeParse({ messageId: 'invalid' }).success).toBe(false);
  });

  it('validates replay metadata before returning stored output', () => {
    expect(
      storedCustomerAgentReplySchema.safeParse({
        runId: id,
        intent: 'faq',
        route: 'direct_query',
        status: 'reply',
        text: 'معلومة موثقة.',
        confidence: 0.9,
        productId: null,
        variantId: null,
        evidence: [
          {
            kind: 'knowledge',
            toolName: 'find_knowledge',
            toolCallId: '10000000-0000-4000-8000-000000000002',
          },
        ],
        toolCallIds: ['10000000-0000-4000-8000-000000000002'],
        groundingValidated: true,
        handoffReason: null,
      }).success,
    ).toBe(true);
    expect(
      storedCustomerAgentReplySchema.safeParse({
        runId: id,
        intent: 'faq',
        route: 'direct_query',
        status: 'reply',
        text: 'سعر غير موثق',
        confidence: 1,
        productId: null,
        variantId: null,
        evidence: [],
        toolCallIds: ['not-a-uuid'],
        groundingValidated: true,
        handoffReason: null,
      }).success,
    ).toBe(false);
  });
});
