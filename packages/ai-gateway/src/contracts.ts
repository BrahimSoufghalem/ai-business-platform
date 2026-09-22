export type AiTask = 'classify' | 'compose' | 'negotiate' | 'summarize';

export type AiIntent =
  | 'faq'
  | 'product_discovery'
  | 'pricing'
  | 'order_draft'
  | 'order_confirmation'
  | 'order_status'
  | 'handoff'
  | 'summary';

export type AiRoutingPreference = 'cost' | 'speed' | 'quality' | 'balanced';
export type AiModelSpeed = 'fast' | 'balanced' | 'quality';
export type AiToolKind = 'read' | 'command';
export type AiToolCallStatus = 'succeeded' | 'rejected' | 'failed';
export type AiRunOutcome = 'completed' | 'handoff';

export interface AiSchema<TValue> {
  safeParse(
    value: unknown,
  ):
    | { readonly success: true; readonly data: TValue }
    | { readonly success: false; readonly error: unknown };
}

export type AiHandoffReason =
  | 'budget_exceeded'
  | 'provider_unavailable'
  | 'circuit_open'
  | 'invalid_output'
  | 'tool_rejected'
  | 'tool_failed'
  | 'timeout'
  | 'safety_fallback';

export interface AiUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface AiPromptDefinition {
  readonly id: string;
  readonly task: AiTask;
  readonly version: string;
  readonly systemInstruction: string;
}

export interface AiToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly kind: AiToolKind;
  readonly inputJsonSchema: Readonly<Record<string, unknown>>;
}

export interface AiProviderToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

export interface AiProviderToolResult {
  readonly callId: string;
  readonly name: string;
  readonly trust: 'validated_tool_result';
  readonly output: unknown;
}

export interface AiProviderRequest {
  readonly runId: string;
  readonly tenantId: string;
  readonly task: AiTask;
  readonly intent: AiIntent;
  readonly model: string;
  readonly prompt: AiPromptDefinition;
  readonly input: {
    readonly trust: 'untrusted_content';
    readonly value: unknown;
  };
  readonly toolResults: readonly AiProviderToolResult[];
  readonly tools: readonly AiToolDescriptor[];
  readonly outputSchemaName: string;
  readonly outputJsonSchema: Readonly<Record<string, unknown>>;
  readonly maximumOutputTokens: number;
}

interface AiProviderResponseBase {
  readonly providerRequestId: string | null;
  readonly usage: AiUsage;
}

export interface AiProviderOutputResponse extends AiProviderResponseBase {
  readonly kind: 'output';
  readonly output: unknown;
}

export interface AiProviderToolCallsResponse extends AiProviderResponseBase {
  readonly kind: 'tool_calls';
  readonly calls: readonly AiProviderToolCall[];
}

export interface AiProviderHandoffResponse extends AiProviderResponseBase {
  readonly kind: 'handoff';
  readonly reason: AiHandoffReason;
}

export type AiProviderResponse =
  AiProviderOutputResponse | AiProviderToolCallsResponse | AiProviderHandoffResponse;

export interface AiProvider {
  readonly name: string;
  complete(request: AiProviderRequest, signal: AbortSignal): Promise<AiProviderResponse>;
}

export interface AiModelRoute {
  readonly id: string;
  readonly routingVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly fallback?: boolean;
  readonly tasks: readonly AiTask[];
  readonly intents?: readonly AiIntent[];
  readonly speed: AiModelSpeed;
  readonly quality: number;
  readonly priority: number;
  readonly inputCostUsdPerMillionTokens: number;
  readonly outputCostUsdPerMillionTokens: number;
  readonly timeoutMs: number;
  readonly maximumAttempts: number;
}

export interface AiGatewayRunRequest<TOutput> {
  readonly tenantId: string;
  readonly conversationId?: string | null;
  readonly correlationId: string;
  readonly task: AiTask;
  readonly intent: AiIntent;
  readonly promptVersion: string;
  readonly input: unknown;
  readonly outputSchemaName: string;
  readonly outputSchema: AiSchema<TOutput>;
  readonly outputJsonSchema: Readonly<Record<string, unknown>>;
  readonly maximumCostUsd: number;
  readonly maximumOutputTokens: number;
  readonly estimatedInputTokens?: number;
  readonly routingPreference?: AiRoutingPreference;
  readonly allowedToolNames?: readonly string[];
  readonly maximumToolCalls?: number;
}

export interface AiProviderAttemptTrace {
  readonly provider: string;
  readonly model: string;
  readonly attempt: number;
  readonly status: 'succeeded' | 'failed' | 'handoff';
  readonly errorCode: string | null;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
}

export interface AiToolCallTrace {
  readonly id: string;
  readonly providerCallId: string;
  readonly name: string;
  readonly kind: AiToolKind;
  readonly status: AiToolCallStatus;
  readonly latencyMs: number;
  readonly safeInput: unknown;
  readonly safeOutput: unknown;
  readonly errorCode: string | null;
}

interface AiGatewayResultBase {
  readonly id: string;
  readonly outcome: AiRunOutcome;
  readonly provider: string | null;
  readonly model: string | null;
  readonly modelVersion: string | null;
  readonly promptVersion: string;
  readonly routingVersion: string | null;
  readonly latencyMs: number;
  readonly usage: AiUsage;
  readonly estimatedCostUsd: number;
  readonly fallbackUsed: boolean;
  readonly attempts: readonly AiProviderAttemptTrace[];
  readonly toolCalls: readonly AiToolCallTrace[];
}

export interface AiGatewayCompletedResult<TOutput> extends AiGatewayResultBase {
  readonly outcome: 'completed';
  readonly output: TOutput;
  readonly handoffReason: null;
}

export interface AiGatewayHandoffResult extends AiGatewayResultBase {
  readonly outcome: 'handoff';
  readonly output: null;
  readonly handoffReason: AiHandoffReason;
}

export type AiGatewayResult<TOutput> = AiGatewayCompletedResult<TOutput> | AiGatewayHandoffResult;

export interface AiRunTraceRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly conversationId: string | null;
  readonly correlationId: string;
  readonly task: AiTask;
  readonly intent: AiIntent;
  readonly promptVersion: string;
  readonly routingVersion: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly modelVersion: string | null;
  readonly outcome: AiRunOutcome;
  readonly handoffReason: AiHandoffReason | null;
  readonly latencyMs: number;
  readonly usage: AiUsage;
  readonly estimatedCostUsd: number;
  readonly attemptCount: number;
  readonly fallbackUsed: boolean;
  readonly safeInput: unknown;
  readonly safeOutput: unknown;
  readonly attempts: readonly AiProviderAttemptTrace[];
  readonly toolCalls: readonly AiToolCallTrace[];
  readonly createdAt: string;
}

export interface AiRunTraceSink {
  record(run: AiRunTraceRecord): Promise<void>;
}

export interface AiGateway {
  run<TOutput>(request: AiGatewayRunRequest<TOutput>): Promise<AiGatewayResult<TOutput>>;
}
