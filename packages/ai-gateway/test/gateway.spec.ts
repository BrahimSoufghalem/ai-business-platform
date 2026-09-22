import { describe, expect, it } from 'vitest';
import type {
  AiModelRoute,
  AiProvider,
  AiProviderRequest,
  AiProviderResponse,
  AiRunTraceRecord,
  AiRunTraceSink,
  AiSchema,
} from '../src/index.js';
import {
  AiCircuitBreaker,
  PromptRegistry,
  RoutedAiGateway,
  SafeHandoffProvider,
  ToolRegistry,
} from '../src/index.js';

function schema<T>(parse: (value: unknown) => T | null): AiSchema<T> {
  return {
    safeParse(value) {
      const parsed = parse(value);
      return parsed === null
        ? { success: false as const, error: new Error('invalid') }
        : { success: true as const, data: parsed };
    },
  };
}

const replySchema = schema<{ reply: string }>((value) => {
  if (
    typeof value === 'object' &&
    value !== null &&
    'reply' in value &&
    typeof value.reply === 'string'
  ) {
    return { reply: value.reply };
  }
  return null;
});

const outputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { reply: { type: 'string' } },
  required: ['reply'],
} as const;

class ScriptedProvider implements AiProvider {
  readonly name: string;
  readonly requests: AiProviderRequest[] = [];
  readonly #handler: (
    request: AiProviderRequest,
    call: number,
  ) => AiProviderResponse | Promise<AiProviderResponse>;

  constructor(
    name: string,
    handler: (
      request: AiProviderRequest,
      call: number,
    ) => AiProviderResponse | Promise<AiProviderResponse>,
  ) {
    this.name = name;
    this.#handler = handler;
  }

  async complete(request: AiProviderRequest): Promise<AiProviderResponse> {
    this.requests.push(request);
    return this.#handler(request, this.requests.length);
  }
}

class MemoryTraceSink implements AiRunTraceSink {
  readonly records: AiRunTraceRecord[] = [];

  async record(run: AiRunTraceRecord): Promise<void> {
    this.records.push(run);
  }
}

function route(provider: string, overrides: Partial<AiModelRoute> = {}): AiModelRoute {
  return {
    id: `${provider}-route`,
    routingVersion: 'routing-v1',
    provider,
    model: `${provider}-model`,
    modelVersion: '2026-09-22',
    tasks: ['compose'],
    intents: ['pricing'],
    speed: 'balanced',
    quality: 70,
    priority: 10,
    inputCostUsdPerMillionTokens: 0.2,
    outputCostUsdPerMillionTokens: 0.4,
    timeoutMs: 500,
    maximumAttempts: 1,
    ...overrides,
  };
}

function prompts(): PromptRegistry {
  const registry = new PromptRegistry();
  registry.register({
    id: 'customer-reply',
    task: 'compose',
    version: 'v1',
    systemInstruction: 'Return a grounded customer reply.',
  });
  return registry;
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: '11111111-1111-4111-8111-111111111111',
    conversationId: null,
    correlationId: 'gateway-test',
    task: 'compose' as const,
    intent: 'pricing' as const,
    promptVersion: 'v1',
    input: { question: 'What is the price?' },
    outputSchemaName: 'customer_reply',
    outputSchema: replySchema,
    outputJsonSchema,
    maximumCostUsd: 1,
    maximumOutputTokens: 200,
    ...overrides,
  };
}

describe('routed AI gateway', () => {
  it('keeps tools and structured output stable when the provider changes', async () => {
    let toolExecutions = 0;
    const tools = new ToolRegistry();
    tools.register({
      name: 'get_effective_price',
      description: 'Read the current validated price.',
      kind: 'read',
      allowedIntents: ['pricing'],
      inputSchema: schema<{ productId: string }>((value) =>
        typeof value === 'object' &&
        value !== null &&
        'productId' in value &&
        typeof value.productId === 'string'
          ? { productId: value.productId }
          : null,
      ),
      outputSchema: schema<{ price: string }>((value) =>
        typeof value === 'object' &&
        value !== null &&
        'price' in value &&
        typeof value.price === 'string'
          ? { price: value.price }
          : null,
      ),
      inputJsonSchema: {
        type: 'object',
        properties: { productId: { type: 'string' } },
        required: ['productId'],
      },
      async execute() {
        toolExecutions += 1;
        return { price: '100.00' };
      },
    });
    const providerFactory = (name: string) =>
      new ScriptedProvider(name, (providerRequest, call) =>
        call === 1
          ? {
              kind: 'tool_calls',
              calls: [
                {
                  id: `${name}-call`,
                  name: 'get_effective_price',
                  arguments: { productId: 'product-1' },
                },
              ],
              providerRequestId: `${name}-1`,
              usage: { inputTokens: 40, outputTokens: 10 },
            }
          : {
              kind: 'output',
              output: { reply: `Price ${String(providerRequest.toolResults[0]?.output)}` },
              providerRequestId: `${name}-2`,
              usage: { inputTokens: 50, outputTokens: 12 },
            },
      );
    for (const name of ['provider-a', 'provider-b']) {
      const provider = providerFactory(name);
      const gateway = new RoutedAiGateway({
        providers: [provider],
        routes: [route(name)],
        prompts: prompts(),
        tools,
      });
      const result = await gateway.run(request());
      expect(result.outcome).toBe('completed');
      expect(result.provider).toBe(name);
      expect(result.toolCalls[0]?.status).toBe('succeeded');
      expect(provider.requests[0]?.tools.map((tool) => tool.name)).toEqual(['get_effective_price']);
    }
    expect(toolExecutions).toBe(2);
  });

  it('routes independently by cost or speed', async () => {
    const cheap = new ScriptedProvider('cheap', () => ({
      kind: 'output',
      output: { reply: 'cheap' },
      providerRequestId: 'cheap-1',
      usage: { inputTokens: 5, outputTokens: 5 },
    }));
    const fast = new ScriptedProvider('fast', () => ({
      kind: 'output',
      output: { reply: 'fast' },
      providerRequestId: 'fast-1',
      usage: { inputTokens: 5, outputTokens: 5 },
    }));
    const routes = [
      route('cheap', {
        speed: 'quality',
        inputCostUsdPerMillionTokens: 0.01,
        outputCostUsdPerMillionTokens: 0.01,
      }),
      route('fast', {
        speed: 'fast',
        inputCostUsdPerMillionTokens: 2,
        outputCostUsdPerMillionTokens: 4,
      }),
    ];
    const costGateway = new RoutedAiGateway({
      providers: [cheap, fast],
      routes,
      prompts: prompts(),
    });
    expect((await costGateway.run(request({ routingPreference: 'cost' }))).provider).toBe('cheap');

    const speedGateway = new RoutedAiGateway({
      providers: [cheap, fast],
      routes,
      prompts: prompts(),
    });
    expect((await speedGateway.run(request({ routingPreference: 'speed' }))).provider).toBe('fast');
  });

  it('retries, opens the circuit, and uses the safe fallback provider', async () => {
    const primary = new ScriptedProvider('primary', () => {
      throw new Error('temporary_failure');
    });
    const fallback = new SafeHandoffProvider();
    const circuit = new AiCircuitBreaker({ failureThreshold: 2, resetAfterMs: 60_000 });
    const gateway = new RoutedAiGateway({
      providers: [primary, fallback],
      routes: [
        route('primary', { maximumAttempts: 2 }),
        route(fallback.name, {
          fallback: true,
          inputCostUsdPerMillionTokens: 0,
          outputCostUsdPerMillionTokens: 0,
          priority: 100,
        }),
      ],
      prompts: prompts(),
      circuitBreaker: circuit,
    });
    const first = await gateway.run(request());
    expect(first).toMatchObject({
      outcome: 'handoff',
      provider: 'safe-handoff',
      fallbackUsed: true,
      handoffReason: 'safety_fallback',
    });
    expect(primary.requests).toHaveLength(2);
    expect(circuit.state('primary:primary-model')).toBe('open');

    await gateway.run(request({ correlationId: 'second-run' }));
    expect(primary.requests).toHaveLength(2);
  });

  it('times out a stalled provider and falls back without exposing a partial result', async () => {
    const stalled = new ScriptedProvider(
      'stalled',
      () => new Promise<AiProviderResponse>(() => undefined),
    );
    const fallback = new SafeHandoffProvider();
    const gateway = new RoutedAiGateway({
      providers: [stalled, fallback],
      routes: [
        route('stalled', { timeoutMs: 50 }),
        route(fallback.name, {
          fallback: true,
          inputCostUsdPerMillionTokens: 0,
          outputCostUsdPerMillionTokens: 0,
        }),
      ],
      prompts: prompts(),
    });
    const result = await gateway.run(request());
    expect(result).toMatchObject({
      outcome: 'handoff',
      provider: 'safe-handoff',
      fallbackUsed: true,
    });
    expect(result.attempts[0]).toMatchObject({
      provider: 'stalled',
      status: 'failed',
      errorCode: 'provider_timeout',
    });
  });

  it('rejects invalid structured output before application code can consume it', async () => {
    const invalid = new ScriptedProvider('invalid', () => ({
      kind: 'output',
      output: { executable: 'do_not_run' },
      providerRequestId: 'invalid-1',
      usage: { inputTokens: 10, outputTokens: 5 },
    }));
    const fallback = new SafeHandoffProvider();
    const gateway = new RoutedAiGateway({
      providers: [invalid, fallback],
      routes: [
        route('invalid'),
        route(fallback.name, {
          fallback: true,
          inputCostUsdPerMillionTokens: 0,
          outputCostUsdPerMillionTokens: 0,
        }),
      ],
      prompts: prompts(),
    });
    const result = await gateway.run(request());
    expect(result.outcome).toBe('handoff');
    expect(result.attempts[0]).toMatchObject({
      provider: 'invalid',
      status: 'failed',
      errorCode: 'invalid_structured_output',
    });
  });

  it('never sends invalid tool arguments to a command handler', async () => {
    let writes = 0;
    const tools = new ToolRegistry();
    tools.register({
      name: 'confirm_order',
      description: 'Confirm one customer-approved order.',
      kind: 'command',
      allowedIntents: ['pricing'],
      inputSchema: schema<{ approved: true }>((value) =>
        typeof value === 'object' &&
        value !== null &&
        'approved' in value &&
        value.approved === true
          ? { approved: true }
          : null,
      ),
      outputSchema: schema<{ status: 'confirmed' }>((value) =>
        typeof value === 'object' &&
        value !== null &&
        'status' in value &&
        value.status === 'confirmed'
          ? { status: 'confirmed' }
          : null,
      ),
      inputJsonSchema: {
        type: 'object',
        properties: { approved: { const: true } },
        required: ['approved'],
      },
      async execute() {
        writes += 1;
        return { status: 'confirmed' };
      },
    });
    const primary = new ScriptedProvider('primary', () => ({
      kind: 'tool_calls',
      calls: [{ id: 'bad-call', name: 'confirm_order', arguments: { approved: false } }],
      providerRequestId: 'primary-1',
      usage: { inputTokens: 10, outputTokens: 10 },
    }));
    const fallback = new SafeHandoffProvider();
    const gateway = new RoutedAiGateway({
      providers: [primary, fallback],
      routes: [
        route('primary'),
        route(fallback.name, {
          fallback: true,
          inputCostUsdPerMillionTokens: 0,
          outputCostUsdPerMillionTokens: 0,
        }),
      ],
      prompts: prompts(),
      tools,
    });
    const result = await gateway.run(request({ allowedToolNames: ['confirm_order'] }));
    expect(writes).toBe(0);
    expect(result.outcome).toBe('handoff');
    expect(result.toolCalls[0]).toMatchObject({
      name: 'confirm_order',
      status: 'rejected',
      errorCode: 'invalid_tool_input',
    });
  });

  it('does not retry a provider after a command may have written', async () => {
    let writes = 0;
    const tools = new ToolRegistry();
    tools.register({
      name: 'save_draft',
      description: 'Save an idempotent draft.',
      kind: 'command',
      allowedIntents: ['pricing'],
      inputSchema: schema<{ idempotencyKey: string }>((value) =>
        typeof value === 'object' &&
        value !== null &&
        'idempotencyKey' in value &&
        typeof value.idempotencyKey === 'string'
          ? { idempotencyKey: value.idempotencyKey }
          : null,
      ),
      outputSchema: schema<{ id: string }>((value) =>
        typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string'
          ? { id: value.id }
          : null,
      ),
      inputJsonSchema: { type: 'object' },
      async execute() {
        writes += 1;
        return { id: 'draft-1' };
      },
    });
    const primary = new ScriptedProvider('primary', (_providerRequest, call) => {
      if (call === 1) {
        return {
          kind: 'tool_calls',
          calls: [
            {
              id: 'write-1',
              name: 'save_draft',
              arguments: { idempotencyKey: 'key-1' },
            },
          ],
          providerRequestId: 'primary-1',
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      }
      throw new Error('provider_failed_after_command');
    });
    const fallback = new SafeHandoffProvider();
    const gateway = new RoutedAiGateway({
      providers: [primary, fallback],
      routes: [
        route('primary', { maximumAttempts: 3 }),
        route(fallback.name, {
          fallback: true,
          inputCostUsdPerMillionTokens: 0,
          outputCostUsdPerMillionTokens: 0,
        }),
      ],
      prompts: prompts(),
      tools,
    });
    const result = await gateway.run(request({ allowedToolNames: ['save_draft'] }));
    expect(writes).toBe(1);
    expect(primary.requests).toHaveLength(2);
    expect(result).toMatchObject({
      outcome: 'handoff',
      provider: 'primary',
      fallbackUsed: false,
      handoffReason: 'provider_unavailable',
    });
  });

  it('fails closed on budget and records redacted, measurable telemetry', async () => {
    const provider = new ScriptedProvider('primary', () => ({
      kind: 'output',
      output: { reply: 'Contact alice@example.test using Bearer secret-value.' },
      providerRequestId: 'primary-1',
      usage: { inputTokens: 15, outputTokens: 8 },
    }));
    const sink = new MemoryTraceSink();
    const gateway = new RoutedAiGateway({
      providers: [provider],
      routes: [route('primary')],
      prompts: prompts(),
      traceSink: sink,
    });
    const completed = await gateway.run(
      request({
        input: { question: 'Price?', apiKey: 'super-secret', phone: '+213555123456' },
      }),
    );
    expect(completed).toMatchObject({
      outcome: 'completed',
      provider: 'primary',
      model: 'primary-model',
      promptVersion: 'v1',
      routingVersion: 'routing-v1',
      usage: { inputTokens: 15, outputTokens: 8 },
    });
    expect(completed.estimatedCostUsd).toBeGreaterThan(0);
    expect(sink.records[0]?.safeInput).toEqual({
      question: 'Price?',
      apiKey: '[REDACTED]',
      phone: '[REDACTED]',
    });
    expect(sink.records[0]?.safeOutput).toEqual({
      reply: 'Contact [REDACTED] using [REDACTED].',
    });

    const budgetResult = await gateway.run(
      request({ correlationId: 'budget-run', maximumCostUsd: 0 }),
    );
    expect(budgetResult).toMatchObject({
      outcome: 'handoff',
      handoffReason: 'budget_exceeded',
    });
  });
});
