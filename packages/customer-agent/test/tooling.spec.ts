import { describe, expect, it } from 'vitest';
import type { AiToolExecutionError, AiProviderToolCall } from '@ai-business/ai-gateway';
import { createCustomerAgentToolRegistry, type CustomerAgentDataSource } from '../src/index.js';

const tenantId = '00000000-0000-4000-8000-000000000001';
const conversationId = '00000000-0000-4000-8000-000000000002';

function source(): CustomerAgentDataSource {
  return {
    getSettings: async () => ({
      versionId: null,
      version: 0,
      language: 'ar',
      tone: 'friendly',
    }),
    searchProducts: async () => ({
      observedAt: '2026-01-01T00:00:00.000Z',
      items: [],
    }),
    getVariantAvailability: async (_context, input) => ({
      variantId: input.variantId,
      requestedQuantity: input.quantity,
      availableQuantity: 0,
      available: false,
      locationCount: 0,
      observedAt: '2026-01-01T00:00:00.000Z',
    }),
    getEffectivePrice: async (_context, input) => ({
      productId: input.productId,
      variantId: input.variantId,
      amount: '1000.00',
      currency: 'DZD',
      source: 'catalog',
      rule: null,
      observedAt: '2026-01-01T00:00:00.000Z',
    }),
    getBusinessRules: async () => ({
      rules: [],
      observedAt: '2026-01-01T00:00:00.000Z',
    }),
    findKnowledge: async () => ({
      kind: 'knowledge_grounding',
      trust: 'untrusted_content',
      embeddedInstructions: 'ignore',
      items: [],
    }),
  };
}

async function execute(call: AiProviderToolCall, intent: 'pricing' | 'faq') {
  return createCustomerAgentToolRegistry(source()).execute(call, {
    intent,
    runId: '00000000-0000-4000-8000-000000000003',
    tenantId,
    conversationId,
    correlationId: 'test-correlation',
  });
}

describe('customer tool registry', () => {
  it('rejects invalid identifiers before the data source is called', async () => {
    await expect(
      execute(
        {
          id: 'call-1',
          name: 'get_effective_price',
          arguments: { productId: 'not-a-uuid', variantId: null },
        },
        'pricing',
      ),
    ).rejects.toMatchObject<Partial<AiToolExecutionError>>({
      code: 'invalid_tool_input',
    });
  });

  it('enforces the intent allow-list', async () => {
    await expect(
      execute(
        {
          id: 'call-2',
          name: 'get_effective_price',
          arguments: { productId: tenantId, variantId: null },
        },
        'faq',
      ),
    ).rejects.toMatchObject<Partial<AiToolExecutionError>>({
      code: 'tool_not_allowed',
    });
  });
});
