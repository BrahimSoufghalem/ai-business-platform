import { randomUUID } from 'node:crypto';
import { AiCircuitBreaker } from './circuit-breaker.js';
import type {
  AiGateway,
  AiGatewayHandoffResult,
  AiGatewayResult,
  AiGatewayRunRequest,
  AiHandoffReason,
  AiModelRoute,
  AiProvider,
  AiProviderAttemptTrace,
  AiProviderRequest,
  AiProviderResponse,
  AiProviderToolResult,
  AiRoutingPreference,
  AiRunTraceRecord,
  AiRunTraceSink,
  AiToolCallTrace,
  AiUsage,
} from './contracts.js';
import type { PromptRegistry } from './prompt-registry.js';
import { redactAiTelemetry } from './redaction.js';
import { AiToolExecutionError, ToolRegistry } from './tool-registry.js';

export interface RoutedAiGatewayOptions {
  readonly providers: readonly AiProvider[];
  readonly routes: readonly AiModelRoute[];
  readonly prompts: PromptRegistry;
  readonly tools?: ToolRegistry;
  readonly traceSink?: AiRunTraceSink;
  readonly circuitBreaker?: AiCircuitBreaker;
  readonly now?: () => number;
  readonly idFactory?: () => string;
}

interface MutableUsage {
  inputTokens: number;
  outputTokens: number;
}

interface FailureDetails {
  readonly code: string;
  readonly handoffReason: AiHandoffReason;
  readonly toolTrace: AiToolCallTrace | null;
  readonly commandMayHaveExecuted: boolean;
}

function routeKey(route: AiModelRoute): string {
  return `${route.provider}:${route.model}`;
}

function assertNonnegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be nonnegative.`);
}

function validateRoute(route: AiModelRoute, providers: ReadonlyMap<string, AiProvider>): void {
  if (
    route.id.trim().length === 0 ||
    route.routingVersion.trim().length === 0 ||
    route.model.trim().length === 0 ||
    route.modelVersion.trim().length === 0
  ) {
    throw new Error('Route, routing version, model, and model version are required.');
  }
  if (!providers.has(route.provider)) {
    throw new Error(`Route ${route.id} references unregistered provider ${route.provider}.`);
  }
  if (route.tasks.length === 0) throw new Error(`Route ${route.id} must support a task.`);
  if (!Number.isFinite(route.quality) || route.quality < 0 || route.quality > 100) {
    throw new Error(`Route ${route.id} quality must be between 0 and 100.`);
  }
  if (!Number.isSafeInteger(route.priority) || route.priority < 0) {
    throw new Error(`Route ${route.id} priority must be a nonnegative integer.`);
  }
  assertNonnegativeFinite(route.inputCostUsdPerMillionTokens, 'Input token cost');
  assertNonnegativeFinite(route.outputCostUsdPerMillionTokens, 'Output token cost');
  if (!Number.isSafeInteger(route.timeoutMs) || route.timeoutMs < 50 || route.timeoutMs > 120_000) {
    throw new Error(`Route ${route.id} timeout must be between 50 and 120000 milliseconds.`);
  }
  if (
    !Number.isSafeInteger(route.maximumAttempts) ||
    route.maximumAttempts < 1 ||
    route.maximumAttempts > 5
  ) {
    throw new Error(`Route ${route.id} maximum attempts must be between 1 and 5.`);
  }
}

function usageCost(route: AiModelRoute, usage: AiUsage): number {
  return (
    (usage.inputTokens * route.inputCostUsdPerMillionTokens +
      usage.outputTokens * route.outputCostUsdPerMillionTokens) /
    1_000_000
  );
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function estimateTokens(value: unknown): number {
  try {
    return Math.max(1, Math.ceil(JSON.stringify(value).length / 4));
  } catch {
    return 1_000;
  }
}

function preflightCost(
  route: AiModelRoute,
  estimatedInputTokens: number,
  maximumOutputTokens: number,
): number {
  return usageCost(route, {
    inputTokens: estimatedInputTokens,
    outputTokens: maximumOutputTokens,
  });
}

function speedRank(route: AiModelRoute): number {
  return route.speed === 'fast' ? 0 : route.speed === 'balanced' ? 1 : 2;
}

function sortRoutes(
  routes: readonly AiModelRoute[],
  preference: AiRoutingPreference,
  estimatedInputTokens: number,
  maximumOutputTokens: number,
): AiModelRoute[] {
  return [...routes].sort((left, right) => {
    const fallbackDifference = Number(Boolean(left.fallback)) - Number(Boolean(right.fallback));
    if (fallbackDifference !== 0) return fallbackDifference;
    const leftCost = preflightCost(left, estimatedInputTokens, maximumOutputTokens);
    const rightCost = preflightCost(right, estimatedInputTokens, maximumOutputTokens);
    if (preference === 'cost' && leftCost !== rightCost) return leftCost - rightCost;
    if (preference === 'speed' && speedRank(left) !== speedRank(right)) {
      return speedRank(left) - speedRank(right);
    }
    if (preference === 'quality' && left.quality !== right.quality) {
      return right.quality - left.quality;
    }
    if (preference === 'balanced') {
      const leftScore = left.priority * 100 + speedRank(left) * 10 + leftCost;
      const rightScore = right.priority * 100 + speedRank(right) * 10 + rightCost;
      if (leftScore !== rightScore) return leftScore - rightScore;
    }
    if (left.priority !== right.priority) return left.priority - right.priority;
    if (leftCost !== rightCost) return leftCost - rightCost;
    return left.id.localeCompare(right.id);
  });
}

async function invokeWithTimeout(
  provider: AiProvider,
  request: AiProviderRequest,
  timeoutMs: number,
): Promise<AiProviderResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('provider_timeout'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([provider.complete(request, controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function failureDetails(error: unknown): FailureDetails {
  if (error instanceof AiToolExecutionError) {
    return {
      code: error.code,
      handoffReason: error.trace.status === 'rejected' ? 'tool_rejected' : 'tool_failed',
      toolTrace: error.trace,
      commandMayHaveExecuted: error.commandMayHaveExecuted,
    };
  }
  const message = error instanceof Error ? error.message : 'provider_failure';
  if (message === 'provider_timeout' || (error instanceof Error && error.name === 'AbortError')) {
    return {
      code: 'provider_timeout',
      handoffReason: 'timeout',
      toolTrace: null,
      commandMayHaveExecuted: false,
    };
  }
  if (message === 'invalid_structured_output' || message === 'provider_protocol_error') {
    return {
      code: message,
      handoffReason: 'invalid_output',
      toolTrace: null,
      commandMayHaveExecuted: false,
    };
  }
  return {
    code: message.startsWith('provider_http_') ? message : 'provider_failure',
    handoffReason: 'provider_unavailable',
    toolTrace: null,
    commandMayHaveExecuted: false,
  };
}

function addUsage(target: MutableUsage, addition: AiUsage): void {
  target.inputTokens += addition.inputTokens;
  target.outputTokens += addition.outputTokens;
}

function validateUsage(usage: AiUsage): void {
  if (
    !Number.isSafeInteger(usage.inputTokens) ||
    usage.inputTokens < 0 ||
    !Number.isSafeInteger(usage.outputTokens) ||
    usage.outputTokens < 0
  ) {
    throw new Error('provider_protocol_error');
  }
}

export class RoutedAiGateway implements AiGateway {
  readonly #providers = new Map<string, AiProvider>();
  readonly #routes: readonly AiModelRoute[];
  readonly #prompts: PromptRegistry;
  readonly #tools: ToolRegistry;
  readonly #traceSink: AiRunTraceSink | undefined;
  readonly #circuitBreaker: AiCircuitBreaker;
  readonly #now: () => number;
  readonly #idFactory: () => string;

  constructor(options: RoutedAiGatewayOptions) {
    for (const provider of options.providers) {
      if (this.#providers.has(provider.name)) {
        throw new Error(`Provider ${provider.name} is already registered.`);
      }
      this.#providers.set(provider.name, provider);
    }
    const routeIds = new Set<string>();
    for (const route of options.routes) {
      if (routeIds.has(route.id)) throw new Error(`Route ${route.id} is duplicated.`);
      routeIds.add(route.id);
      validateRoute(route, this.#providers);
    }
    this.#routes = [...options.routes];
    this.#prompts = options.prompts;
    this.#tools = options.tools ?? new ToolRegistry();
    this.#traceSink = options.traceSink;
    this.#circuitBreaker =
      options.circuitBreaker ?? new AiCircuitBreaker({ failureThreshold: 3, resetAfterMs: 30_000 });
    this.#now = options.now ?? Date.now;
    this.#idFactory = options.idFactory ?? randomUUID;
  }

  async #finish<TOutput>(
    request: AiGatewayRunRequest<TOutput>,
    startedAt: number,
    result: AiGatewayResult<TOutput>,
  ): Promise<AiGatewayResult<TOutput>> {
    const finished: AiGatewayResult<TOutput> = {
      ...result,
      latencyMs: Math.max(0, this.#now() - startedAt),
    };
    const record: AiRunTraceRecord = {
      id: finished.id,
      tenantId: request.tenantId,
      conversationId: request.conversationId ?? null,
      correlationId: request.correlationId,
      task: request.task,
      intent: request.intent,
      promptVersion: finished.promptVersion,
      routingVersion: finished.routingVersion,
      provider: finished.provider,
      model: finished.model,
      modelVersion: finished.modelVersion,
      outcome: finished.outcome,
      handoffReason: finished.handoffReason,
      latencyMs: finished.latencyMs,
      usage: finished.usage,
      estimatedCostUsd: finished.estimatedCostUsd,
      attemptCount: finished.attempts.length,
      fallbackUsed: finished.fallbackUsed,
      safeInput: redactAiTelemetry(request.input),
      safeOutput: redactAiTelemetry(
        finished.outcome === 'completed'
          ? finished.output
          : { handoffReason: finished.handoffReason },
      ),
      attempts: finished.attempts,
      toolCalls: finished.toolCalls,
      createdAt: new Date(startedAt).toISOString(),
    };
    await this.#traceSink?.record(record);
    return finished;
  }

  async run<TOutput>(request: AiGatewayRunRequest<TOutput>): Promise<AiGatewayResult<TOutput>> {
    const startedAt = this.#now();
    const runId = this.#idFactory();
    if (request.tenantId.trim().length === 0 || request.correlationId.trim().length === 0) {
      throw new Error('Tenant ID and correlation ID are required.');
    }
    assertNonnegativeFinite(request.maximumCostUsd, 'Maximum AI cost');
    if (
      !Number.isSafeInteger(request.maximumOutputTokens) ||
      request.maximumOutputTokens < 1 ||
      request.maximumOutputTokens > 100_000
    ) {
      throw new Error('Maximum output tokens must be between 1 and 100000.');
    }
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(request.outputSchemaName)) {
      throw new Error('Output schema name must be a stable identifier.');
    }
    const prompt = this.#prompts.get(request.task, request.promptVersion);
    const estimatedInputTokens =
      request.estimatedInputTokens ??
      estimateTokens({ prompt: prompt.systemInstruction, input: request.input });
    if (!Number.isSafeInteger(estimatedInputTokens) || estimatedInputTokens < 1) {
      throw new Error('Estimated input tokens must be a positive integer.');
    }
    const maximumToolCalls = request.maximumToolCalls ?? 6;
    if (!Number.isSafeInteger(maximumToolCalls) || maximumToolCalls < 0 || maximumToolCalls > 20) {
      throw new Error('Maximum tool calls must be between 0 and 20.');
    }
    const availableRoutes = this.#routes.filter(
      (route) =>
        route.tasks.includes(request.task) &&
        (route.intents === undefined || route.intents.includes(request.intent)),
    );
    const routes = sortRoutes(
      availableRoutes,
      request.routingPreference ?? 'balanced',
      estimatedInputTokens,
      request.maximumOutputTokens,
    );
    const usage: MutableUsage = { inputTokens: 0, outputTokens: 0 };
    const attempts: AiProviderAttemptTrace[] = [];
    const toolCalls: AiToolCallTrace[] = [];
    let totalCost = 0;
    let attemptedRouteCount = 0;
    let lastRoute: AiModelRoute | null = null;
    let lastReason: AiHandoffReason = routes.length === 0 ? 'provider_unavailable' : 'circuit_open';
    let budgetRejected = false;
    const descriptors = this.#tools.descriptors(request.intent, request.allowedToolNames);

    const handoff = async (
      reason: AiHandoffReason,
      route: AiModelRoute | null,
      fallbackUsed: boolean,
    ): Promise<AiGatewayResult<TOutput>> =>
      this.#finish<TOutput>(request, startedAt, {
        id: runId,
        outcome: 'handoff',
        provider: route?.provider ?? null,
        model: route?.model ?? null,
        modelVersion: route?.modelVersion ?? null,
        promptVersion: prompt.version,
        routingVersion: route?.routingVersion ?? null,
        latencyMs: 0,
        usage: { ...usage },
        estimatedCostUsd: roundUsd(totalCost),
        fallbackUsed,
        attempts: [...attempts],
        toolCalls: [...toolCalls],
        output: null,
        handoffReason: reason,
      } as AiGatewayHandoffResult);

    for (const [routeIndex, route] of routes.entries()) {
      lastRoute = route;
      const remainingBudget = request.maximumCostUsd - totalCost;
      const routePreflightCost = preflightCost(
        route,
        estimatedInputTokens,
        request.maximumOutputTokens,
      );
      if (routePreflightCost > remainingBudget) {
        budgetRejected = true;
        lastReason = 'budget_exceeded';
        continue;
      }
      const circuitKey = routeKey(route);
      if (!this.#circuitBreaker.canRequest(circuitKey)) {
        lastReason = 'circuit_open';
        continue;
      }
      const provider = this.#providers.get(route.provider);
      if (!provider) continue;
      attemptedRouteCount += 1;
      const fallbackUsed = Boolean(route.fallback) || routeIndex > 0 || attemptedRouteCount > 1;

      for (let attempt = 1; attempt <= route.maximumAttempts; attempt += 1) {
        const attemptStartedAt = this.#now();
        const attemptUsage: MutableUsage = { inputTokens: 0, outputTokens: 0 };
        let attemptCost = 0;
        let commandExecuted = false;
        const providerToolResults: AiProviderToolResult[] = [];
        try {
          while (true) {
            const nextInputEstimate = Math.max(
              estimatedInputTokens,
              estimateTokens({
                prompt: prompt.systemInstruction,
                input: request.input,
                toolResults: providerToolResults,
              }),
            );
            const nextCallCost = preflightCost(
              route,
              nextInputEstimate,
              request.maximumOutputTokens,
            );
            if (totalCost + nextCallCost > request.maximumCostUsd) {
              lastReason = 'budget_exceeded';
              attempts.push({
                provider: route.provider,
                model: route.model,
                attempt,
                status: 'handoff',
                errorCode: 'budget_exceeded',
                latencyMs: Math.max(0, this.#now() - attemptStartedAt),
                inputTokens: attemptUsage.inputTokens,
                outputTokens: attemptUsage.outputTokens,
                estimatedCostUsd: roundUsd(attemptCost),
              });
              return handoff('budget_exceeded', route, fallbackUsed);
            }
            const response = await invokeWithTimeout(
              provider,
              {
                runId,
                tenantId: request.tenantId,
                task: request.task,
                intent: request.intent,
                model: route.model,
                prompt,
                input: { trust: 'untrusted_content', value: request.input },
                toolResults: providerToolResults,
                tools: descriptors,
                outputSchemaName: request.outputSchemaName,
                outputJsonSchema: request.outputJsonSchema,
                maximumOutputTokens: request.maximumOutputTokens,
              },
              route.timeoutMs,
            );
            validateUsage(response.usage);
            addUsage(usage, response.usage);
            addUsage(attemptUsage, response.usage);
            const responseCost = usageCost(route, response.usage);
            totalCost += responseCost;
            attemptCost += responseCost;
            if (totalCost > request.maximumCostUsd) {
              attempts.push({
                provider: route.provider,
                model: route.model,
                attempt,
                status: 'handoff',
                errorCode: 'budget_exceeded',
                latencyMs: Math.max(0, this.#now() - attemptStartedAt),
                inputTokens: attemptUsage.inputTokens,
                outputTokens: attemptUsage.outputTokens,
                estimatedCostUsd: roundUsd(attemptCost),
              });
              return handoff('budget_exceeded', route, fallbackUsed);
            }
            if (response.kind === 'handoff') {
              this.#circuitBreaker.recordSuccess(circuitKey);
              attempts.push({
                provider: route.provider,
                model: route.model,
                attempt,
                status: 'handoff',
                errorCode: null,
                latencyMs: Math.max(0, this.#now() - attemptStartedAt),
                inputTokens: attemptUsage.inputTokens,
                outputTokens: attemptUsage.outputTokens,
                estimatedCostUsd: roundUsd(attemptCost),
              });
              return handoff(response.reason, route, fallbackUsed);
            }
            if (response.kind === 'tool_calls') {
              if (response.calls.length === 0) throw new Error('provider_protocol_error');
              for (const call of response.calls) {
                if (toolCalls.length >= maximumToolCalls) {
                  throw new Error('maximum_tool_calls_exceeded');
                }
                const executed = await this.#tools.execute(call, {
                  intent: request.intent,
                  ...(request.allowedToolNames
                    ? { allowedToolNames: request.allowedToolNames }
                    : {}),
                  runId,
                  tenantId: request.tenantId,
                  conversationId: request.conversationId ?? null,
                  correlationId: request.correlationId,
                });
                toolCalls.push(executed.trace);
                providerToolResults.push(executed.result);
                commandExecuted ||= executed.commandExecuted;
              }
              continue;
            }
            const parsed = request.outputSchema.safeParse(response.output);
            if (!parsed.success) throw new Error('invalid_structured_output');
            this.#circuitBreaker.recordSuccess(circuitKey);
            attempts.push({
              provider: route.provider,
              model: route.model,
              attempt,
              status: 'succeeded',
              errorCode: null,
              latencyMs: Math.max(0, this.#now() - attemptStartedAt),
              inputTokens: attemptUsage.inputTokens,
              outputTokens: attemptUsage.outputTokens,
              estimatedCostUsd: roundUsd(attemptCost),
            });
            return this.#finish(request, startedAt, {
              id: runId,
              outcome: 'completed',
              provider: route.provider,
              model: route.model,
              modelVersion: route.modelVersion,
              promptVersion: prompt.version,
              routingVersion: route.routingVersion,
              latencyMs: 0,
              usage: { ...usage },
              estimatedCostUsd: roundUsd(totalCost),
              fallbackUsed,
              attempts: [...attempts],
              toolCalls: [...toolCalls],
              output: parsed.data,
              handoffReason: null,
            });
          }
        } catch (error) {
          const failure = failureDetails(error);
          if (failure.toolTrace) toolCalls.push(failure.toolTrace);
          lastReason =
            failure.code === 'maximum_tool_calls_exceeded'
              ? 'tool_rejected'
              : failure.handoffReason;
          this.#circuitBreaker.recordFailure(circuitKey);
          attempts.push({
            provider: route.provider,
            model: route.model,
            attempt,
            status: 'failed',
            errorCode: failure.code,
            latencyMs: Math.max(0, this.#now() - attemptStartedAt),
            inputTokens: attemptUsage.inputTokens,
            outputTokens: attemptUsage.outputTokens,
            estimatedCostUsd: roundUsd(attemptCost),
          });
          if (commandExecuted || failure.commandMayHaveExecuted) {
            return handoff(lastReason, route, fallbackUsed);
          }
        }
      }
    }
    if (budgetRejected && attemptedRouteCount === 0) lastReason = 'budget_exceeded';
    return handoff(lastReason, lastRoute, attemptedRouteCount > 1);
  }
}
