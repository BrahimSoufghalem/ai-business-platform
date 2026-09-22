import { randomUUID } from 'node:crypto';
import {
  AiToolExecutionError,
  redactAiTelemetry,
  type AiGatewayResult,
  type AiHandoffReason,
  type AiIntent,
  type AiProviderAttemptTrace,
  type AiRunTraceRecord,
  type AiRunTraceSink,
  type AiToolCallTrace,
  type ToolRegistry,
} from '@ai-business/ai-gateway';
import { buildCustomerAgentContext } from './context-builder.js';
import type {
  CustomerAgentDynamicContext,
  CustomerAgentEvidence,
  CustomerAgentIntentDecision,
  CustomerAgentMessage,
  CustomerAgentModelOutput,
  CustomerAgentProduct,
  CustomerAgentProductVariant,
  CustomerAgentReply,
  CustomerAgentRuntimeOptions,
  CustomerAgentSettings,
  CustomerAgentTurnInput,
  DirectExecutionResult,
  EffectivePriceResult,
  KnowledgeSearchResult,
  ProductSearchResult,
  VariantAvailabilityResult,
} from './contracts.js';
import {
  customerAgentModelOutputJsonSchema,
  customerAgentModelOutputSchema,
  verifyGroundedCustomerOutput,
} from './grounding.js';
import { routeCustomerIntent } from './intent-router.js';
import { CUSTOMER_AGENT_PROMPT_VERSION } from './prompt.js';
import { assessCustomerInput, boundedUntrustedText } from './safety.js';
import {
  CUSTOMER_AGENT_TOOL_NAMES,
  createCustomerAgentToolRegistry,
  customerAgentToolSchemas,
} from './tooling.js';

const DIRECT_PROMPT_VERSION = 'customer-agent-direct-v1';
const ROUTING_VERSION = 'customer-agent-router-v1';

class BufferedTraceSink implements AiRunTraceSink {
  #record: AiRunTraceRecord | null = null;

  async record(run: AiRunTraceRecord): Promise<void> {
    if (this.#record) throw new Error('customer_agent_duplicate_gateway_trace');
    this.#record = run;
  }

  take(runId: string): AiRunTraceRecord {
    if (!this.#record || this.#record.id !== runId) {
      throw new Error('customer_agent_gateway_trace_missing');
    }
    return this.#record;
  }
}

function languageFromText(text: string): CustomerAgentSettings['language'] {
  if (/[\u0600-\u06FF]/u.test(text)) return 'ar';
  if (/\b(?:bonjour|salut|prix|livraison|merci|disponible)\b/iu.test(text)) return 'fr';
  return 'en';
}

function localText(
  language: CustomerAgentSettings['language'],
  key:
    | 'greeting'
    | 'handoff'
    | 'unsafe'
    | 'ask_product'
    | 'not_found'
    | 'choose_product'
    | 'choose_variant'
    | 'knowledge_missing'
    | 'tool_failure'
    | 'grounding_failure',
): string {
  const messages = {
    ar: {
      greeting: 'مرحبًا! كيف يمكنني مساعدتك بخصوص منتجات المتجر؟',
      handoff: 'سأحوّل طلبك إلى موظف لمساعدتك بأمان.',
      unsafe: 'لا أستطيع تنفيذ هذا الطلب. سأحوّل المحادثة إلى موظف.',
      ask_product: 'ما اسم المنتج أو رمزه الذي تريد الاستفسار عنه؟',
      not_found: 'لم أجد منتجًا مطابقًا. هل يمكنك ذكر الاسم أو الرمز بشكل أدق؟',
      choose_product: 'وجدت عدة منتجات محتملة. أي منتج تقصد؟',
      choose_variant: 'يوجد أكثر من خيار لهذا المنتج. ما المقاس أو اللون أو المواصفة المطلوبة؟',
      knowledge_missing: 'لا أملك معلومة منشورة وموثوقة عن ذلك حاليًا.',
      tool_failure: 'تعذر التحقق من بيانات المتجر الآن. سأحوّل المحادثة إلى موظف.',
      grounding_failure: 'لم أتمكن من التحقق من الإجابة بشكل كافٍ. سأحوّلك إلى موظف.',
    },
    fr: {
      greeting: 'Bonjour ! Comment puis-je vous aider concernant les produits du magasin ?',
      handoff: 'Je vais transmettre votre demande à un conseiller.',
      unsafe: 'Je ne peux pas exécuter cette demande. Je la transmets à un conseiller.',
      ask_product: 'Quel est le nom ou le code du produit recherché ?',
      not_found: 'Je ne trouve pas de produit correspondant. Pouvez-vous préciser le nom ?',
      choose_product: 'Plusieurs produits correspondent. Lequel souhaitez-vous ?',
      choose_variant:
        'Plusieurs variantes existent. Quelle taille, couleur ou option souhaitez-vous ?',
      knowledge_missing: 'Je ne dispose pas actuellement d’une information publiée et vérifiée.',
      tool_failure: 'Les données du magasin sont indisponibles. Je transmets la conversation.',
      grounding_failure: 'Je ne peux pas vérifier suffisamment cette réponse. Je vous transfère.',
    },
    en: {
      greeting: 'Hello! How can I help with the store’s products?',
      handoff: 'I will transfer your request to a team member.',
      unsafe: 'I cannot carry out that request. I will transfer this conversation.',
      ask_product: 'What is the product name or code?',
      not_found: 'I could not find a matching product. Could you provide a more precise name?',
      choose_product: 'I found several possible products. Which one do you mean?',
      choose_variant: 'This product has multiple options. Which size, color, or specification?',
      knowledge_missing: 'I do not currently have a published, verified answer for that.',
      tool_failure: 'Store data could not be verified. I will transfer the conversation.',
      grounding_failure: 'I could not verify the answer sufficiently. I will transfer you.',
    },
  } as const;
  return messages[language][key];
}

function normalizeMatch(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ar')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function primitiveValues(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (Array.isArray(value)) return value.flatMap((item) => primitiveValues(item));
  return [];
}

function selectVariant(
  product: CustomerAgentProduct,
  message: string,
): CustomerAgentProductVariant | null {
  if (product.variants.length === 1) return product.variants[0] ?? null;
  const normalizedMessage = normalizeMatch(message);
  const matches = product.variants.filter((variant) => {
    const candidates = [
      variant.sku,
      variant.name ?? '',
      ...Object.values(variant.attributes).flatMap((value) => primitiveValues(value)),
    ];
    return candidates.some((candidate) => {
      const normalizedCandidate = normalizeMatch(candidate);
      return normalizedCandidate.length > 0 && normalizedMessage.includes(normalizedCandidate);
    });
  });
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function listNames(items: readonly { readonly name: string }[]): string {
  return items
    .slice(0, 3)
    .map((item) => item.name)
    .join('، ');
}

function statusFromAction(
  action: CustomerAgentModelOutput['action'],
): CustomerAgentReply['status'] {
  return action === 'clarify' ? 'clarification' : action;
}

function toolsForIntent(intent: AiIntent): readonly string[] {
  if (intent === 'faq') return ['find_knowledge'];
  if (intent === 'pricing') {
    return ['search_products', 'get_effective_price', 'get_business_rules'];
  }
  if (intent === 'product_discovery') {
    return ['search_products', 'get_variant_availability', 'find_knowledge'];
  }
  return [...CUSTOMER_AGENT_TOOL_NAMES];
}

function outputEvidence(
  kind: CustomerAgentEvidence['kind'],
  call: AiToolCallTrace,
): CustomerAgentEvidence {
  return { kind, toolName: call.name, toolCallId: call.id };
}

interface ToolExecutionState {
  readonly registry: ToolRegistry;
  readonly runId: string;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly correlationId: string;
  readonly intent: AiIntent;
  readonly traces: AiToolCallTrace[];
}

async function executeLocalTool(
  state: ToolExecutionState,
  name: string,
  args: unknown,
  providerCallId: string,
): Promise<{ output: unknown; trace: AiToolCallTrace }> {
  const execution = await state.registry.execute(
    { id: providerCallId, name, arguments: args },
    {
      intent: state.intent,
      allowedToolNames: toolsForIntent(state.intent),
      runId: state.runId,
      tenantId: state.tenantId,
      conversationId: state.conversationId,
      correlationId: state.correlationId,
    },
  );
  state.traces.push(execution.trace);
  return { output: execution.result.output, trace: execution.trace };
}

function createReply(input: {
  runId: string;
  decision: CustomerAgentIntentDecision;
  status: CustomerAgentReply['status'];
  text: string;
  confidence?: number;
  productId?: string | null;
  variantId?: string | null;
  evidence?: readonly CustomerAgentEvidence[];
  traces?: readonly AiToolCallTrace[];
  groundingValidated?: boolean;
  handoffReason?: string | null;
}): CustomerAgentReply {
  return {
    runId: input.runId,
    intent: input.decision.intent,
    route: input.decision.route,
    status: input.status,
    text: boundedUntrustedText(input.text, 2_000),
    confidence: input.confidence ?? (input.status === 'reply' ? 1 : 0),
    productId: input.productId ?? null,
    variantId: input.variantId ?? null,
    evidence: input.evidence ?? [],
    toolCallIds: (input.traces ?? []).map((trace) => trace.id),
    groundingValidated: input.groundingValidated ?? true,
    handoffReason: input.handoffReason ?? null,
  };
}

export class CustomerAgentRuntime {
  readonly #options: CustomerAgentRuntimeOptions;
  readonly #now: () => number;
  readonly #idFactory: () => string;

  constructor(options: CustomerAgentRuntimeOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#idFactory = options.idFactory ?? randomUUID;
  }

  async #recordLocalTurn(
    turn: {
      readonly tenantId: string;
      readonly conversationId: string;
      readonly correlationId: string;
      readonly safeInput: unknown;
    },
    reply: CustomerAgentReply,
    traces: readonly AiToolCallTrace[],
    startedAt: number,
    outcome: 'completed' | 'handoff',
    handoffReason: AiHandoffReason | null,
  ): Promise<void> {
    const latencyMs = Math.max(0, this.#now() - startedAt);
    const model = reply.route === 'static' ? 'static-reply-v1' : 'direct-query-v1';
    const attempt: AiProviderAttemptTrace = {
      provider: 'deterministic',
      model,
      attempt: 1,
      status: outcome === 'completed' ? 'succeeded' : 'handoff',
      errorCode: handoffReason,
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    };
    await this.#options.traceSink.record({
      id: reply.runId,
      tenantId: turn.tenantId,
      conversationId: turn.conversationId,
      correlationId: turn.correlationId,
      task: 'compose',
      intent: reply.intent,
      promptVersion: DIRECT_PROMPT_VERSION,
      routingVersion: ROUTING_VERSION,
      provider: 'deterministic',
      model,
      modelVersion: '1',
      outcome,
      handoffReason,
      latencyMs,
      usage: { inputTokens: 0, outputTokens: 0 },
      estimatedCostUsd: 0,
      attemptCount: 1,
      fallbackUsed: false,
      safeInput: redactAiTelemetry(turn.safeInput),
      safeOutput: redactAiTelemetry(reply),
      attempts: [attempt],
      toolCalls: traces,
      createdAt: new Date(startedAt).toISOString(),
    });
  }

  async #direct(
    context: CustomerAgentDynamicContext,
    decision: CustomerAgentIntentDecision,
    input: {
      readonly tenantId: string;
      readonly conversationId: string;
      readonly correlationId: string;
      readonly message: CustomerAgentMessage;
    },
    registry: ToolRegistry,
    startedAt: number,
  ): Promise<DirectExecutionResult> {
    const runId = this.#idFactory();
    const state: ToolExecutionState = {
      registry,
      runId,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      correlationId: input.correlationId,
      intent: decision.intent,
      traces: [],
    };
    const language = context.settings.language;
    try {
      if (decision.reason === 'direct_faq') {
        const tool = await executeLocalTool(
          state,
          'find_knowledge',
          { query: context.currentMessage, limit: 5 },
          `${runId}:knowledge`,
        );
        const parsed = customerAgentToolSchemas.findKnowledgeOutputSchema.parse(
          tool.output,
        ) as KnowledgeSearchResult;
        const item = parsed.items[0];
        let reply: CustomerAgentReply;
        if (!item) {
          reply = createReply({
            runId,
            decision,
            status: 'clarification',
            text: localText(language, 'knowledge_missing'),
            traces: state.traces,
          });
        } else if (!assessCustomerInput(item.content).safe) {
          reply = createReply({
            runId,
            decision: { ...decision, route: 'handoff' },
            status: 'handoff',
            text: localText(language, 'grounding_failure'),
            traces: state.traces,
            handoffReason: 'unsafe_retrieved_knowledge',
          });
        } else {
          reply = createReply({
            runId,
            decision,
            status: 'reply',
            text: boundedUntrustedText(item.content, 1_200),
            confidence: 0.9,
            evidence: [outputEvidence('knowledge', tool.trace)],
            traces: state.traces,
          });
        }
        await this.#recordLocalTurn(
          { ...input, safeInput: context },
          reply,
          state.traces,
          startedAt,
          reply.status === 'handoff' ? 'handoff' : 'completed',
          reply.status === 'handoff' ? 'safety_fallback' : null,
        );
        return { reply, toolCalls: state.traces };
      }

      if (decision.query.length === 0 && context.linkedProductId === null) {
        const reply = createReply({
          runId,
          decision,
          status: 'clarification',
          text: localText(language, 'ask_product'),
        });
        await this.#recordLocalTurn(
          { ...input, safeInput: context },
          reply,
          state.traces,
          startedAt,
          'completed',
          null,
        );
        return { reply, toolCalls: state.traces };
      }

      const search = await executeLocalTool(
        state,
        'search_products',
        {
          query: decision.query,
          productId: context.linkedProductId,
          limit: 5,
        },
        `${runId}:products`,
      );
      const products = customerAgentToolSchemas.searchProductsOutputSchema.parse(
        search.output,
      ) as ProductSearchResult;
      if (products.items.length === 0) {
        const reply = createReply({
          runId,
          decision,
          status: 'clarification',
          text: localText(language, 'not_found'),
          evidence: [outputEvidence('product', search.trace)],
          traces: state.traces,
        });
        await this.#recordLocalTurn(
          { ...input, safeInput: context },
          reply,
          state.traces,
          startedAt,
          'completed',
          null,
        );
        return { reply, toolCalls: state.traces };
      }
      if (products.items.length > 1) {
        const reply = createReply({
          runId,
          decision,
          status: 'clarification',
          text: `${localText(language, 'choose_product')} ${listNames(products.items)}`,
          evidence: [outputEvidence('product', search.trace)],
          traces: state.traces,
        });
        await this.#recordLocalTurn(
          { ...input, safeInput: context },
          reply,
          state.traces,
          startedAt,
          'completed',
          null,
        );
        return { reply, toolCalls: state.traces };
      }

      const product = products.items[0];
      if (!product) throw new Error('validated_product_missing');
      const variant = selectVariant(product, input.message.content);
      if (product.variants.length > 1 && !variant) {
        const variantNames = product.variants.map((item) => ({
          name: item.name ?? item.sku,
        }));
        const reply = createReply({
          runId,
          decision,
          status: 'clarification',
          text: `${localText(language, 'choose_variant')} ${listNames(variantNames)}`,
          productId: product.id,
          evidence: [outputEvidence('product', search.trace)],
          traces: state.traces,
        });
        await this.#recordLocalTurn(
          { ...input, safeInput: context },
          reply,
          state.traces,
          startedAt,
          'completed',
          null,
        );
        return { reply, toolCalls: state.traces };
      }

      if (decision.reason === 'direct_price') {
        const priceCall = await executeLocalTool(
          state,
          'get_effective_price',
          { productId: product.id, variantId: variant?.id ?? null },
          `${runId}:price`,
        );
        const price = customerAgentToolSchemas.effectivePriceOutputSchema.parse(
          priceCall.output,
        ) as EffectivePriceResult;
        const variantLabel = variant ? ` (${variant.name ?? variant.sku})` : '';
        const text =
          language === 'fr'
            ? `Le prix de ${product.name}${variantLabel} est de ${price.amount} ${price.currency}.`
            : language === 'en'
              ? `The price of ${product.name}${variantLabel} is ${price.amount} ${price.currency}.`
              : `سعر ${product.name}${variantLabel} هو ${price.amount} ${price.currency}.`;
        const reply = createReply({
          runId,
          decision,
          status: 'reply',
          text,
          confidence: 1,
          productId: product.id,
          variantId: variant?.id ?? null,
          evidence: [
            outputEvidence('product', search.trace),
            outputEvidence('price', priceCall.trace),
          ],
          traces: state.traces,
        });
        await this.#recordLocalTurn(
          { ...input, safeInput: context },
          reply,
          state.traces,
          startedAt,
          'completed',
          null,
        );
        return { reply, toolCalls: state.traces };
      }

      if (!variant) {
        const reply = createReply({
          runId,
          decision,
          status: 'clarification',
          text: localText(language, 'choose_variant'),
          productId: product.id,
          evidence: [outputEvidence('product', search.trace)],
          traces: state.traces,
        });
        await this.#recordLocalTurn(
          { ...input, safeInput: context },
          reply,
          state.traces,
          startedAt,
          'completed',
          null,
        );
        return { reply, toolCalls: state.traces };
      }
      const availabilityCall = await executeLocalTool(
        state,
        'get_variant_availability',
        { variantId: variant.id, quantity: decision.requestedQuantity },
        `${runId}:availability`,
      );
      const availability = customerAgentToolSchemas.availabilityOutputSchema.parse(
        availabilityCall.output,
      ) as VariantAvailabilityResult;
      const variantLabel = variant.name ?? variant.sku;
      const text =
        language === 'fr'
          ? availability.available
            ? `${product.name} (${variantLabel}) est disponible pour la quantité demandée.`
            : `${product.name} (${variantLabel}) n’est pas disponible pour la quantité demandée.`
          : language === 'en'
            ? availability.available
              ? `${product.name} (${variantLabel}) is available for the requested quantity.`
              : `${product.name} (${variantLabel}) is not available for the requested quantity.`
            : availability.available
              ? `${product.name} (${variantLabel}) متوفر بالكمية المطلوبة.`
              : `${product.name} (${variantLabel}) غير متوفر بالكمية المطلوبة.`;
      const reply = createReply({
        runId,
        decision,
        status: 'reply',
        text,
        confidence: 1,
        productId: product.id,
        variantId: variant.id,
        evidence: [
          outputEvidence('product', search.trace),
          outputEvidence('availability', availabilityCall.trace),
        ],
        traces: state.traces,
      });
      await this.#recordLocalTurn(
        { ...input, safeInput: context },
        reply,
        state.traces,
        startedAt,
        'completed',
        null,
      );
      return { reply, toolCalls: state.traces };
    } catch (error) {
      if (error instanceof AiToolExecutionError) state.traces.push(error.trace);
      const reason: AiHandoffReason =
        error instanceof AiToolExecutionError && error.trace.status === 'rejected'
          ? 'tool_rejected'
          : 'tool_failed';
      const reply = createReply({
        runId,
        decision: { ...decision, route: 'handoff' },
        status: 'handoff',
        text: localText(language, 'tool_failure'),
        traces: state.traces,
        groundingValidated: false,
        handoffReason: reason,
      });
      await this.#recordLocalTurn(
        { ...input, safeInput: context },
        reply,
        state.traces,
        startedAt,
        'handoff',
        reason,
      );
      return { reply, toolCalls: state.traces };
    }
  }

  async run(input: CustomerAgentTurnInput): Promise<CustomerAgentReply> {
    const startedAt = this.#now();
    const message = input.conversation.messages.find((item) => item.id === input.messageId);
    if (!message || message.direction !== 'inbound' || message.senderType !== 'customer') {
      throw new Error('Customer agent requires an existing inbound customer message.');
    }
    if (input.conversation.status !== 'bot') {
      throw new Error('Customer agent can only run while the conversation is assigned to the bot.');
    }
    const decision = routeCustomerIntent(message.content);
    const registry = createCustomerAgentToolRegistry(this.#options.dataSource);
    const language = languageFromText(message.content);

    if (decision.route === 'handoff') {
      const runId = this.#idFactory();
      const reply = createReply({
        runId,
        decision,
        status: 'handoff',
        text: localText(language, decision.reason === 'unsafe_input' ? 'unsafe' : 'handoff'),
        groundingValidated: true,
        handoffReason: decision.reason,
      });
      await this.#recordLocalTurn(
        {
          tenantId: input.tenantId,
          conversationId: input.conversation.id,
          correlationId: input.correlationId,
          safeInput: {
            currentMessage: boundedUntrustedText(message.content, 2_000),
            decision,
          },
        },
        reply,
        [],
        startedAt,
        'handoff',
        'safety_fallback',
      );
      return reply;
    }

    const context = await buildCustomerAgentContext({
      dataSource: this.#options.dataSource,
      tenantId: input.tenantId,
      conversationId: input.conversation.id,
      correlationId: input.correlationId,
      decision,
      message,
      messages: input.conversation.messages,
      linkedProductId: input.conversation.linkedProductId,
      signal: new AbortController().signal,
    });

    if (decision.route === 'static') {
      const reply = createReply({
        runId: this.#idFactory(),
        decision,
        status: 'reply',
        text: localText(context.settings.language, 'greeting'),
      });
      await this.#recordLocalTurn(
        {
          tenantId: input.tenantId,
          conversationId: input.conversation.id,
          correlationId: input.correlationId,
          safeInput: context,
        },
        reply,
        [],
        startedAt,
        'completed',
        null,
      );
      return reply;
    }

    if (decision.route === 'direct_query') {
      const result = await this.#direct(
        context,
        decision,
        {
          tenantId: input.tenantId,
          conversationId: input.conversation.id,
          correlationId: input.correlationId,
          message,
        },
        registry,
        startedAt,
      );
      return result.reply;
    }

    const bufferedTrace = new BufferedTraceSink();
    const gateway = this.#options.createGateway({
      tools: registry,
      traceSink: bufferedTrace,
    });
    const result: AiGatewayResult<CustomerAgentModelOutput> = await gateway.run({
      tenantId: input.tenantId,
      conversationId: input.conversation.id,
      correlationId: input.correlationId,
      task: 'compose',
      intent: decision.intent,
      promptVersion: CUSTOMER_AGENT_PROMPT_VERSION,
      input: context,
      outputSchemaName: 'customer_agent_reply',
      outputSchema: customerAgentModelOutputSchema,
      outputJsonSchema: customerAgentModelOutputJsonSchema,
      maximumCostUsd: this.#options.maximumCostUsd ?? 0.05,
      maximumOutputTokens: this.#options.maximumOutputTokens ?? 700,
      routingPreference: decision.route === 'strong_model' ? 'quality' : 'speed',
      allowedToolNames: toolsForIntent(decision.intent),
      maximumToolCalls: 6,
    });
    const gatewayTrace = bufferedTrace.take(result.id);
    if (result.outcome === 'handoff') {
      await this.#options.traceSink.record(gatewayTrace);
      return createReply({
        runId: result.id,
        decision: { ...decision, route: 'handoff' },
        status: 'handoff',
        text: localText(context.settings.language, 'tool_failure'),
        traces: result.toolCalls,
        groundingValidated: false,
        handoffReason: result.handoffReason,
      });
    }
    const verification = verifyGroundedCustomerOutput(result.output, result.toolCalls);
    if (!verification.valid) {
      await this.#options.traceSink.record({
        ...gatewayTrace,
        outcome: 'handoff',
        handoffReason: 'safety_fallback',
        safeOutput: redactAiTelemetry({
          blocked: true,
          reasons: verification.reasons,
          modelOutput: gatewayTrace.safeOutput,
        }),
      });
      return createReply({
        runId: result.id,
        decision: { ...decision, route: 'handoff' },
        status: 'handoff',
        text: localText(context.settings.language, 'grounding_failure'),
        traces: result.toolCalls,
        groundingValidated: false,
        handoffReason: verification.reasons.join(','),
      });
    }
    if (result.output.action === 'handoff') {
      await this.#options.traceSink.record({
        ...gatewayTrace,
        outcome: 'handoff',
        handoffReason: 'safety_fallback',
      });
    } else {
      await this.#options.traceSink.record(gatewayTrace);
    }
    return createReply({
      runId: result.id,
      decision,
      status: statusFromAction(result.output.action),
      text: result.output.text,
      confidence: result.output.confidence,
      productId: result.output.selectedProductId,
      variantId: result.output.selectedVariantId,
      evidence: verification.evidence,
      traces: result.toolCalls,
      groundingValidated: true,
      handoffReason: result.output.action === 'handoff' ? 'model_requested_handoff' : null,
    });
  }
}
