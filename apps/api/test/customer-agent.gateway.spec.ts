import { describe, expect, it } from 'vitest';
import { ToolRegistry, type AiRunTraceRecord, type AiSchema } from '@ai-business/ai-gateway';
import {
  CUSTOMER_AGENT_PROMPT_VERSION,
  type CustomerAgentGatewayFactoryInput,
} from '@ai-business/customer-agent';
import { createConfiguredCustomerAgentGateway } from '../src/customer-agent/customer-agent.gateway.js';

const outputSchema: AiSchema<{ readonly text: string }> = {
  safeParse(value) {
    return typeof value === 'object' &&
      value !== null &&
      'text' in value &&
      typeof value.text === 'string'
      ? { success: true as const, data: { text: value.text } }
      : { success: false as const, error: new Error('invalid') };
  },
};

describe('configured customer-agent gateway', () => {
  it('fails closed to a traced handoff when no provider credentials are configured', async () => {
    const records: AiRunTraceRecord[] = [];
    const factoryInput: CustomerAgentGatewayFactoryInput = {
      tools: new ToolRegistry(),
      traceSink: {
        async record(run) {
          records.push(run);
        },
      },
    };
    const gateway = createConfiguredCustomerAgentGateway(factoryInput, {});
    const result = await gateway.run({
      tenantId: '10000000-0000-4000-8000-000000000001',
      conversationId: '10000000-0000-4000-8000-000000000002',
      correlationId: 'gateway-test',
      task: 'compose',
      intent: 'product_discovery',
      promptVersion: CUSTOMER_AGENT_PROMPT_VERSION,
      input: { message: 'أبحث عن هاتف' },
      outputSchemaName: 'gateway_test',
      outputSchema,
      outputJsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      maximumCostUsd: 0.01,
      maximumOutputTokens: 100,
    });

    expect(result.outcome).toBe('handoff');
    expect(result.handoffReason).toBe('safety_fallback');
    expect(records[0]).toMatchObject({
      outcome: 'handoff',
      provider: 'customer-safe-handoff',
      estimatedCostUsd: 0,
    });
  });
});
