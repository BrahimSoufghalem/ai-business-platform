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

/** Provider-neutral contract. Implementations may not bypass tool authorization. */
export interface AiGateway {
  run<TOutput>(request: AiGatewayRequest): Promise<AiGatewayResult<TOutput>>;
}
