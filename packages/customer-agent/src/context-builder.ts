import type {
  CustomerAgentDataSource,
  CustomerAgentDynamicContext,
  CustomerAgentIntentDecision,
  CustomerAgentMessage,
} from './contracts.js';
import { buildCustomerAgentMemory } from './memory.js';
import { boundedUntrustedText } from './safety.js';

export interface BuildCustomerAgentContextInput {
  readonly dataSource: CustomerAgentDataSource;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly correlationId: string;
  readonly decision: CustomerAgentIntentDecision;
  readonly message: CustomerAgentMessage;
  readonly messages: readonly CustomerAgentMessage[];
  readonly linkedProductId: string | null;
  readonly signal: AbortSignal;
}

export async function buildCustomerAgentContext(
  input: BuildCustomerAgentContextInput,
): Promise<CustomerAgentDynamicContext> {
  const settings = await input.dataSource.getSettings({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    correlationId: input.correlationId,
    signal: input.signal,
  });
  return {
    kind: 'customer_agent_context',
    trust: 'untrusted_content',
    decision: input.decision,
    settings,
    linkedProductId: input.linkedProductId,
    currentMessage: boundedUntrustedText(input.message.content, 2_000),
    memory: buildCustomerAgentMemory(input.messages),
  };
}
