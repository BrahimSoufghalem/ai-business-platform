export type AiTask = 'classify' | 'compose' | 'negotiate' | 'summarize';

export interface AiGatewayRequest {
  readonly tenantId: string;
  readonly task: AiTask;
  readonly promptVersion: string;
  readonly input: unknown;
  readonly maximumCostUsd: number;
}

export interface AiGatewayResult<TOutput> {
  readonly provider: string;
  readonly model: string;
  readonly output: TOutput;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
}

export interface KnowledgeGroundingItem {
  readonly id: string;
  readonly versionId: string;
  readonly version: number;
  readonly title: string;
  readonly content: string;
}

export interface KnowledgeGroundingEnvelope {
  readonly kind: 'knowledge_grounding';
  readonly trust: 'untrusted_content';
  readonly embeddedInstructions: 'ignore';
  readonly items: readonly KnowledgeGroundingItem[];
}

/**
 * Keeps retrieved text in a typed data envelope. Provider adapters must pass
 * this as untrusted context, never concatenate it into system instructions.
 */
export function createKnowledgeGroundingEnvelope(
  items: readonly KnowledgeGroundingItem[],
): KnowledgeGroundingEnvelope {
  return {
    kind: 'knowledge_grounding',
    trust: 'untrusted_content',
    embeddedInstructions: 'ignore',
    items: items.map((item) => ({ ...item })),
  };
}

/** Provider-neutral contract. Implementations may not bypass tool authorization. */
export interface AiGateway {
  run<TOutput>(request: AiGatewayRequest): Promise<AiGatewayResult<TOutput>>;
}
