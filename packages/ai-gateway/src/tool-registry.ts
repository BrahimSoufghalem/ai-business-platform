import { randomUUID } from 'node:crypto';
import type {
  AiIntent,
  AiProviderToolCall,
  AiProviderToolResult,
  AiSchema,
  AiToolCallStatus,
  AiToolCallTrace,
  AiToolDescriptor,
  AiToolKind,
} from './contracts.js';
import { redactAiTelemetry } from './redaction.js';

export interface AiToolContext {
  readonly runId: string;
  readonly tenantId: string;
  readonly conversationId: string | null;
  readonly correlationId: string;
  readonly signal: AbortSignal;
}

export interface AiToolDefinition<TInput, TOutput> {
  readonly name: string;
  readonly description: string;
  readonly kind: AiToolKind;
  readonly allowedIntents: readonly AiIntent[];
  readonly inputSchema: AiSchema<TInput>;
  readonly outputSchema: AiSchema<TOutput>;
  readonly inputJsonSchema: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
  execute(input: TInput, context: AiToolContext): Promise<TOutput>;
}

export interface AiToolExecution {
  readonly result: AiProviderToolResult;
  readonly trace: AiToolCallTrace;
  readonly commandExecuted: boolean;
}

export class AiToolExecutionError extends Error {
  readonly code: string;
  readonly trace: AiToolCallTrace;
  readonly commandMayHaveExecuted: boolean;

  constructor(input: {
    code: string;
    message: string;
    trace: AiToolCallTrace;
    commandMayHaveExecuted?: boolean;
  }) {
    super(input.message);
    this.name = 'AiToolExecutionError';
    this.code = input.code;
    this.trace = input.trace;
    this.commandMayHaveExecuted = input.commandMayHaveExecuted ?? false;
  }
}

function requireToolName(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9_]{1,79}$/.test(normalized)) {
    throw new Error('Tool name must use lowercase snake_case.');
  }
  return normalized;
}

function trace(input: {
  id: string;
  call: AiProviderToolCall;
  kind: AiToolKind;
  status: AiToolCallStatus;
  startedAt: number;
  safeInput: unknown;
  safeOutput?: unknown;
  errorCode?: string | null;
}): AiToolCallTrace {
  return {
    id: input.id,
    providerCallId: input.call.id,
    name: input.call.name,
    kind: input.kind,
    status: input.status,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    safeInput: input.safeInput,
    safeOutput: input.safeOutput ?? null,
    errorCode: input.errorCode ?? null,
  };
}

async function executeWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('tool_timeout'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class ToolRegistry {
  readonly #definitions = new Map<string, AiToolDefinition<unknown, unknown>>();

  register<TInput, TOutput>(definition: AiToolDefinition<TInput, TOutput>): void {
    const name = requireToolName(definition.name);
    if (this.#definitions.has(name)) throw new Error(`Tool ${name} is already registered.`);
    if (definition.description.trim().length === 0) {
      throw new Error('Tool description is required.');
    }
    if (definition.allowedIntents.length === 0) {
      throw new Error('Every tool needs at least one allowed intent.');
    }
    if (
      definition.timeoutMs !== undefined &&
      (!Number.isSafeInteger(definition.timeoutMs) ||
        definition.timeoutMs < 50 ||
        definition.timeoutMs > 60_000)
    ) {
      throw new Error('Tool timeout must be between 50 and 60000 milliseconds.');
    }
    this.#definitions.set(name, definition as unknown as AiToolDefinition<unknown, unknown>);
  }

  descriptors(intent: AiIntent, allowedToolNames?: readonly string[]): readonly AiToolDescriptor[] {
    const explicitAllowList = allowedToolNames ? new Set(allowedToolNames) : null;
    return Array.from(this.#definitions.values())
      .filter(
        (definition) =>
          definition.allowedIntents.includes(intent) &&
          (!explicitAllowList || explicitAllowList.has(definition.name)),
      )
      .map((definition) => ({
        name: definition.name,
        description: definition.description,
        kind: definition.kind,
        inputJsonSchema: definition.inputJsonSchema,
      }));
  }

  async execute(
    call: AiProviderToolCall,
    input: {
      readonly intent: AiIntent;
      readonly allowedToolNames?: readonly string[];
      readonly runId: string;
      readonly tenantId: string;
      readonly conversationId: string | null;
      readonly correlationId: string;
    },
  ): Promise<AiToolExecution> {
    const startedAt = Date.now();
    const id = randomUUID();
    const safeInput = redactAiTelemetry(call.arguments);
    const definition = this.#definitions.get(call.name);
    const explicitlyAllowed =
      input.allowedToolNames === undefined || input.allowedToolNames.includes(call.name);
    if (!definition || !definition.allowedIntents.includes(input.intent) || !explicitlyAllowed) {
      const rejectedTrace = trace({
        id,
        call,
        kind: definition?.kind ?? 'read',
        status: 'rejected',
        startedAt,
        safeInput,
        errorCode: 'tool_not_allowed',
      });
      throw new AiToolExecutionError({
        code: 'tool_not_allowed',
        message: `Tool ${call.name} is not allowed for intent ${input.intent}.`,
        trace: rejectedTrace,
      });
    }
    const parsedInput = definition.inputSchema.safeParse(call.arguments);
    if (!parsedInput.success) {
      const rejectedTrace = trace({
        id,
        call,
        kind: definition.kind,
        status: 'rejected',
        startedAt,
        safeInput,
        errorCode: 'invalid_tool_input',
      });
      throw new AiToolExecutionError({
        code: 'invalid_tool_input',
        message: `Tool ${call.name} input failed schema validation.`,
        trace: rejectedTrace,
      });
    }
    let rawOutput: unknown;
    try {
      rawOutput = await executeWithTimeout(
        (signal) =>
          definition.execute(parsedInput.data, {
            runId: input.runId,
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            correlationId: input.correlationId,
            signal,
          }),
        definition.timeoutMs ?? 5_000,
      );
    } catch (error) {
      const errorCode =
        error instanceof Error && error.message === 'tool_timeout'
          ? 'tool_timeout'
          : 'tool_execution_failed';
      const failedTrace = trace({
        id,
        call,
        kind: definition.kind,
        status: 'failed',
        startedAt,
        safeInput,
        errorCode,
      });
      throw new AiToolExecutionError({
        code: errorCode,
        message: `Tool ${call.name} execution failed.`,
        trace: failedTrace,
        commandMayHaveExecuted: definition.kind === 'command',
      });
    }
    const parsedOutput = definition.outputSchema.safeParse(rawOutput);
    if (!parsedOutput.success) {
      const failedTrace = trace({
        id,
        call,
        kind: definition.kind,
        status: 'failed',
        startedAt,
        safeInput,
        safeOutput: redactAiTelemetry(rawOutput),
        errorCode: 'invalid_tool_output',
      });
      throw new AiToolExecutionError({
        code: 'invalid_tool_output',
        message: `Tool ${call.name} output failed schema validation.`,
        trace: failedTrace,
        commandMayHaveExecuted: definition.kind === 'command',
      });
    }
    const successTrace = trace({
      id,
      call,
      kind: definition.kind,
      status: 'succeeded',
      startedAt,
      safeInput,
      safeOutput: redactAiTelemetry(parsedOutput.data),
    });
    return {
      result: {
        callId: call.id,
        name: call.name,
        trust: 'validated_tool_result',
        output: parsedOutput.data,
      },
      trace: successTrace,
      commandExecuted: definition.kind === 'command',
    };
  }
}
