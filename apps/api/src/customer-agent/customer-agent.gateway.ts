import {
  OpenAiCompatibleProvider,
  PromptRegistry,
  RoutedAiGateway,
  SafeHandoffProvider,
  type AiModelRoute,
  type AiProvider,
} from '@ai-business/ai-gateway';
import {
  CUSTOMER_AGENT_PROMPT_VERSION,
  CUSTOMER_AGENT_SYSTEM_INSTRUCTION,
  type CustomerAgentGatewayFactoryInput,
} from '@ai-business/customer-agent';

function configured(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function finiteNumber(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined || value.trim() === '' ? fallback : Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function createConfiguredCustomerAgentGateway(
  input: CustomerAgentGatewayFactoryInput,
  environment: NodeJS.ProcessEnv = process.env,
): RoutedAiGateway {
  const prompts = new PromptRegistry();
  prompts.register({
    id: 'grounded-customer-reply',
    task: 'compose',
    version: CUSTOMER_AGENT_PROMPT_VERSION,
    systemInstruction: CUSTOMER_AGENT_SYSTEM_INSTRUCTION,
  });

  const providers: AiProvider[] = [];
  const routes: AiModelRoute[] = [];
  const baseUrl = configured(environment.AI_PROVIDER_BASE_URL);
  const apiKey = configured(environment.AI_PROVIDER_API_KEY);
  const fastModel = configured(environment.AI_PROVIDER_FAST_MODEL ?? environment.AI_PROVIDER_MODEL);
  const strongModel = configured(environment.AI_PROVIDER_STRONG_MODEL);
  const inputCost = finiteNumber(environment.AI_PROVIDER_INPUT_COST_USD_PER_MILLION, 1, 0, 1_000);
  const outputCost = finiteNumber(environment.AI_PROVIDER_OUTPUT_COST_USD_PER_MILLION, 4, 0, 1_000);
  const timeoutMs = finiteNumber(environment.AI_PROVIDER_TIMEOUT_MS, 15_000, 500, 120_000);

  if (baseUrl && apiKey && fastModel) {
    providers.push(
      new OpenAiCompatibleProvider({
        name: 'primary-openai-compatible',
        baseUrl,
        apiKey,
      }),
    );
    routes.push({
      id: 'customer-fast',
      routingVersion: 'customer-routing-v1',
      provider: 'primary-openai-compatible',
      model: fastModel,
      modelVersion: configured(environment.AI_PROVIDER_MODEL_VERSION) ?? 'configured',
      tasks: ['compose'],
      intents: ['faq', 'product_discovery', 'pricing'],
      speed: 'fast',
      quality: 75,
      priority: 0,
      inputCostUsdPerMillionTokens: inputCost,
      outputCostUsdPerMillionTokens: outputCost,
      timeoutMs,
      maximumAttempts: 2,
    });
    if (strongModel && strongModel !== fastModel) {
      routes.push({
        id: 'customer-strong',
        routingVersion: 'customer-routing-v1',
        provider: 'primary-openai-compatible',
        model: strongModel,
        modelVersion: configured(environment.AI_PROVIDER_STRONG_MODEL_VERSION) ?? 'configured',
        tasks: ['compose'],
        intents: ['product_discovery', 'pricing'],
        speed: 'quality',
        quality: 95,
        priority: 1,
        inputCostUsdPerMillionTokens: inputCost,
        outputCostUsdPerMillionTokens: outputCost,
        timeoutMs,
        maximumAttempts: 2,
      });
    }
  }

  providers.push(new SafeHandoffProvider({ name: 'customer-safe-handoff' }));
  routes.push({
    id: 'customer-safe-handoff',
    routingVersion: 'customer-routing-v1',
    provider: 'customer-safe-handoff',
    model: 'safe-handoff',
    modelVersion: '1',
    fallback: true,
    tasks: ['compose'],
    intents: ['faq', 'product_discovery', 'pricing'],
    speed: 'fast',
    quality: 0,
    priority: 100,
    inputCostUsdPerMillionTokens: 0,
    outputCostUsdPerMillionTokens: 0,
    timeoutMs: 500,
    maximumAttempts: 1,
  });

  return new RoutedAiGateway({
    providers,
    routes,
    prompts,
    tools: input.tools,
    traceSink: input.traceSink,
  });
}
