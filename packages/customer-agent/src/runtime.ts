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
  CustomerAgentConversation,
  CustomerDraftOrderResult,
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
  ConfirmDraftResult,
  DraftMutationResult,
  EffectivePriceResult,
  KnowledgeSearchResult,
  ProductSearchResult,
  PriceOfferResult,
  VariantAvailabilityResult,
} from './contracts.js';
import {
  customerAgentModelOutputJsonSchema,
  customerAgentModelOutputSchema,
  verifyGroundedCustomerOutput,
} from './grounding.js';
import { routeCustomerIntent } from './intent-router.js';
import {
  extractCustomerPhone,
  extractRequestedPrice,
  extractRequestedQuantity,
  extractShippingAddress,
  isAmbiguousOrderAffirmation,
  isExplicitOrderConfirmation,
  requestsVariantChange,
} from './order-intent.js';
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
    return ['search_products', 'get_effective_price', 'evaluate_price_offer', 'get_business_rules'];
  }
  if (intent === 'product_discovery') {
    return ['search_products', 'get_variant_availability', 'find_knowledge'];
  }
  if (intent === 'order_draft') {
    return [
      'search_products',
      'get_variant_availability',
      'get_effective_price',
      'evaluate_price_offer',
      'get_draft_order',
      'create_or_update_draft_order',
      'submit_draft_order',
      'cancel_draft_order',
    ];
  }
  if (intent === 'order_confirmation') {
    return ['get_draft_order', 'confirm_draft_order'];
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
  productId?: string | null | undefined;
  variantId?: string | null | undefined;
  evidence?: readonly CustomerAgentEvidence[];
  traces?: readonly AiToolCallTrace[];
  groundingValidated?: boolean;
  handoffReason?: string | null | undefined;
  draftOrderId?: string | null | undefined;
  orderId?: string | null | undefined;
  orderNumber?: string | null | undefined;
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
    handoffId: null,
    draftOrderId: input.draftOrderId ?? null,
    orderId: input.orderId ?? null,
    orderNumber: input.orderNumber ?? null,
  };
}

function evidenceKindForTool(name: string): CustomerAgentEvidence['kind'] | null {
  if (name === 'search_products') return 'product';
  if (name === 'get_variant_availability') return 'availability';
  if (name === 'get_effective_price' || name === 'evaluate_price_offer') return 'price';
  if (name === 'get_business_rules') return 'rule';
  if (name === 'find_knowledge') return 'knowledge';
  if (name === 'confirm_draft_order') return 'order';
  if (
    name === 'get_draft_order' ||
    name === 'create_or_update_draft_order' ||
    name === 'submit_draft_order' ||
    name === 'cancel_draft_order'
  ) {
    return 'draft';
  }
  return null;
}

function evidenceFromTraces(traces: readonly AiToolCallTrace[]): CustomerAgentEvidence[] {
  return traces.flatMap((trace) => {
    if (trace.status !== 'succeeded') return [];
    const kind = evidenceKindForTool(trace.name);
    return kind ? [outputEvidence(kind, trace)] : [];
  });
}

function orderText(
  language: CustomerAgentSettings['language'],
  key:
    | 'no_active_draft'
    | 'already_confirmed'
    | 'cancelled'
    | 'out_of_stock'
    | 'stale'
    | 'confirm_exactly'
    | 'ask_phone'
    | 'ask_address'
    | 'cannot_confirm',
): string {
  const messages = {
    ar: {
      no_active_draft: 'لا توجد مسودة طلب نشطة في هذه المحادثة.',
      already_confirmed: 'تم تأكيد هذا الطلب بالفعل.',
      cancelled: 'تم إلغاء مسودة الطلب.',
      out_of_stock: 'الكمية المطلوبة غير متوفرة حاليًا. اختر كمية أقل أو خيارًا آخر.',
      stale: 'تغيّرت بيانات الطلب أو السعر. أعد إرسال التعديل لأعرض ملخصًا محدثًا.',
      confirm_exactly: 'للتأكيد الصريح، أرسل حرفيًا: أؤكد الطلب',
      ask_phone: 'أرسل رقم الهاتف لإكمال مسودة الطلب.',
      ask_address: 'أرسل عنوان التوصيل بهذه الصيغة: العنوان: …، المدينة: …',
      cannot_confirm: 'لا يمكن تأكيد الطلب قبل اكتمال البيانات وعرض الملخص النهائي.',
    },
    fr: {
      no_active_draft: 'Aucun brouillon de commande actif dans cette conversation.',
      already_confirmed: 'Cette commande est déjà confirmée.',
      cancelled: 'Le brouillon de commande a été annulé.',
      out_of_stock:
        'La quantité demandée n’est plus disponible. Choisissez une quantité inférieure ou une autre option.',
      stale:
        'La commande ou le prix a changé. Renvoyez la modification pour obtenir un nouveau récapitulatif.',
      confirm_exactly: 'Pour confirmer explicitement, envoyez exactement : Je confirme la commande',
      ask_phone: 'Envoyez votre numéro de téléphone pour compléter le brouillon.',
      ask_address: 'Envoyez l’adresse ainsi : adresse: …, ville: …',
      cannot_confirm:
        'La commande ne peut pas être confirmée avant les informations et le récapitulatif final.',
    },
    en: {
      no_active_draft: 'There is no active draft order in this conversation.',
      already_confirmed: 'This order has already been confirmed.',
      cancelled: 'The draft order was cancelled.',
      out_of_stock:
        'The requested quantity is no longer available. Choose a lower quantity or another option.',
      stale: 'The order or price changed. Send the change again for an updated summary.',
      confirm_exactly: 'To confirm explicitly, send exactly: Confirm the order',
      ask_phone: 'Send your phone number to complete the draft.',
      ask_address: 'Send the address as: address: …, city: …',
      cannot_confirm:
        'The order cannot be confirmed until the details are complete and the final summary is shown.',
    },
  } as const;
  return messages[language][key];
}

function draftSummary(
  draft: CustomerDraftOrderResult,
  language: CustomerAgentSettings['language'],
): string {
  const lines = draft.items.map((item) => {
    const variant = item.variantName ? ` (${item.variantName})` : '';
    return `${item.quantity} × ${item.productName}${variant} — ${item.unitPrice} ${item.currency}`;
  });
  if (language === 'fr') {
    return [
      'Récapitulatif final :',
      ...lines.map((line) => `- ${line}`),
      `Total : ${draft.total} ${draft.currency}.`,
      'Pour confirmer, envoyez exactement : Je confirme la commande',
    ].join('\n');
  }
  if (language === 'en') {
    return [
      'Final order summary:',
      ...lines.map((line) => `- ${line}`),
      `Total: ${draft.total} ${draft.currency}.`,
      'To confirm, send exactly: Confirm the order',
    ].join('\n');
  }
  return [
    'ملخص الطلب النهائي:',
    ...lines.map((line) => `- ${line}`),
    `الإجمالي: ${draft.total} ${draft.currency}.`,
    'للتأكيد أرسل حرفيًا: أؤكد الطلب',
  ].join('\n');
}

function confirmedOrderText(
  order: NonNullable<ConfirmDraftResult['order']>,
  language: CustomerAgentSettings['language'],
): string {
  if (language === 'fr') {
    return `Commande confirmée sous le numéro ${order.orderNumber}. Total : ${order.total} ${order.currency}.`;
  }
  if (language === 'en') {
    return `Order ${order.orderNumber} is confirmed. Total: ${order.total} ${order.currency}.`;
  }
  return `تم تأكيد الطلب رقم ${order.orderNumber}. الإجمالي: ${order.total} ${order.currency}.`;
}

function negotiationText(
  offer: PriceOfferResult,
  product: CustomerAgentProduct,
  variant: CustomerAgentProductVariant,
  language: CustomerAgentSettings['language'],
): string {
  if (offer.outcome === 'counter' && offer.decidedPrice) {
    if (language === 'fr') {
      return `Je peux proposer ${offer.decidedPrice} ${offer.currency}. Si vous acceptez, envoyez : Je veux commander ${product.name} ${variant.name ?? variant.sku} au prix de ${offer.decidedPrice} ${offer.currency}.`;
    }
    if (language === 'en') {
      return `I can offer ${offer.decidedPrice} ${offer.currency}. If you accept, send: I want to order ${product.name} ${variant.name ?? variant.sku} at ${offer.decidedPrice} ${offer.currency}.`;
    }
    return `يمكنني تقديم ${offer.decidedPrice} ${offer.currency}. إذا وافقت فأرسل: أريد شراء ${product.name} ${variant.name ?? variant.sku} بسعر ${offer.decidedPrice} ${offer.currency}.`;
  }
  if (language === 'fr') return 'Cette offre est hors de la politique de prix publiée.';
  if (language === 'en') return 'That offer is outside the published pricing policy.';
  return 'هذا العرض خارج سياسة السعر المنشورة.';
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

  async #order(
    context: CustomerAgentDynamicContext,
    decision: CustomerAgentIntentDecision,
    input: {
      readonly tenantId: string;
      readonly conversation: CustomerAgentConversation;
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
      conversationId: input.conversation.id,
      correlationId: input.correlationId,
      intent: decision.intent,
      traces: [],
    };
    const language = context.settings.language;
    const finish = async (
      reply: CustomerAgentReply,
      traceHandoffReason: AiHandoffReason | null = null,
    ): Promise<DirectExecutionResult> => {
      const handoff = reply.status === 'handoff';
      await this.#recordLocalTurn(
        {
          tenantId: input.tenantId,
          conversationId: input.conversation.id,
          correlationId: input.correlationId,
          safeInput: context,
        },
        reply,
        state.traces,
        startedAt,
        handoff ? 'handoff' : 'completed',
        handoff ? (traceHandoffReason ?? 'safety_fallback') : null,
      );
      return { reply, toolCalls: state.traces };
    };
    const replyFor = (
      text: string,
      status: CustomerAgentReply['status'],
      options: {
        readonly productId?: string | null | undefined;
        readonly variantId?: string | null | undefined;
        readonly draftOrderId?: string | null | undefined;
        readonly orderId?: string | null | undefined;
        readonly orderNumber?: string | null | undefined;
        readonly handoffReason?: string | null | undefined;
      } = {},
    ): CustomerAgentReply =>
      createReply({
        runId,
        decision,
        status,
        text,
        confidence: status === 'reply' ? 1 : 0.9,
        productId: options.productId,
        variantId: options.variantId,
        draftOrderId: options.draftOrderId,
        orderId: options.orderId,
        orderNumber: options.orderNumber,
        handoffReason: options.handoffReason,
        evidence: evidenceFromTraces(state.traces),
        traces: state.traces,
      });

    try {
      let draft: CustomerDraftOrderResult | null = null;
      if (input.conversation.linkedDraftOrderId) {
        const loaded = await executeLocalTool(
          state,
          'get_draft_order',
          { draftOrderId: input.conversation.linkedDraftOrderId },
          `${runId}:draft-load`,
        );
        draft = customerAgentToolSchemas.draftOrderOutputSchema.parse(
          loaded.output,
        ) as CustomerDraftOrderResult;
      }

      if (decision.reason === 'order_cancel') {
        if (!draft) {
          return finish(replyFor(orderText(language, 'no_active_draft'), 'clarification'));
        }
        if (draft.status === 'cancelled') {
          return finish(
            replyFor(orderText(language, 'cancelled'), 'reply', {
              draftOrderId: draft.draftOrderId,
            }),
          );
        }
        if (draft.status === 'confirmed' || input.conversation.linkedOrderId) {
          return finish(
            replyFor(
              language === 'ar'
                ? 'الطلب مؤكد بالفعل؛ سأحوّل طلب الإلغاء إلى موظف.'
                : language === 'fr'
                  ? 'La commande est déjà confirmée ; je transfère la demande d’annulation.'
                  : 'The order is already confirmed; I will transfer the cancellation request.',
              'handoff',
              {
                draftOrderId: draft.draftOrderId,
                orderId: input.conversation.linkedOrderId,
                handoffReason: 'confirmed_order_cancellation',
              },
            ),
          );
        }
        const cancelledCall = await executeLocalTool(
          state,
          'cancel_draft_order',
          {
            draftOrderId: draft.draftOrderId,
            expectedVersion: draft.version,
            reason: 'customer_requested_cancellation',
          },
          `${runId}:draft-cancel`,
        );
        const cancelled = customerAgentToolSchemas.draftMutationOutputSchema.parse(
          cancelledCall.output,
        ) as DraftMutationResult;
        if (cancelled.outcome !== 'saved' || !cancelled.draft) {
          return finish(
            replyFor(orderText(language, 'stale'), 'clarification', {
              draftOrderId: draft.draftOrderId,
            }),
          );
        }
        return finish(
          replyFor(orderText(language, 'cancelled'), 'reply', {
            draftOrderId: cancelled.draft.draftOrderId,
          }),
        );
      }

      if (decision.reason === 'order_confirm') {
        if (!draft) {
          return finish(replyFor(orderText(language, 'no_active_draft'), 'clarification'));
        }
        if (!isExplicitOrderConfirmation(input.message.content)) {
          return finish(
            replyFor(orderText(language, 'confirm_exactly'), 'clarification', {
              draftOrderId: draft.draftOrderId,
            }),
          );
        }
        if (draft.status !== 'awaiting_confirmation' && !input.conversation.linkedOrderId) {
          const text =
            draft.status === 'confirmed'
              ? orderText(language, 'already_confirmed')
              : orderText(language, 'cannot_confirm');
          return finish(replyFor(text, 'clarification', { draftOrderId: draft.draftOrderId }));
        }
        const confirmedCall = await executeLocalTool(
          state,
          'confirm_draft_order',
          {
            draftOrderId: draft.draftOrderId,
            expectedVersion: draft.version,
            approvalMessageId: input.message.id,
            customerApproved: true,
          },
          `${runId}:draft-confirm`,
        );
        const confirmation = customerAgentToolSchemas.confirmDraftOutputSchema.parse(
          confirmedCall.output,
        ) as ConfirmDraftResult;
        if (confirmation.outcome === 'confirmed' && confirmation.order) {
          return finish(
            replyFor(confirmedOrderText(confirmation.order, language), 'reply', {
              productId: confirmation.order.items[0]?.productId ?? null,
              variantId: confirmation.order.items[0]?.variantId ?? null,
              draftOrderId: draft.draftOrderId,
              orderId: confirmation.order.orderId,
              orderNumber: confirmation.order.orderNumber,
            }),
          );
        }
        const text =
          confirmation.outcome === 'out_of_stock'
            ? orderText(language, 'out_of_stock')
            : confirmation.outcome === 'stale'
              ? orderText(language, 'stale')
              : orderText(language, 'cannot_confirm');
        return finish(replyFor(text, 'clarification', { draftOrderId: draft.draftOrderId }));
      }

      if (draft && isAmbiguousOrderAffirmation(input.message.content)) {
        const text =
          draft.status === 'awaiting_confirmation'
            ? `${draftSummary(draft, language)}\n${orderText(language, 'confirm_exactly')}`
            : orderText(language, 'cannot_confirm');
        return finish(
          replyFor(text, 'clarification', {
            productId: draft.items[0]?.productId ?? null,
            variantId: draft.items[0]?.variantId ?? null,
            draftOrderId: draft.draftOrderId,
          }),
        );
      }

      if (draft && (draft.status === 'cancelled' || draft.status === 'confirmed')) {
        if (decision.reason === 'order_update') {
          return finish(
            replyFor(orderText(language, 'no_active_draft'), 'clarification', {
              draftOrderId: draft.draftOrderId,
              orderId: input.conversation.linkedOrderId,
            }),
          );
        }
        draft = null;
      }

      if (!draft && decision.reason === 'order_update') {
        return finish(replyFor(orderText(language, 'no_active_draft'), 'clarification'));
      }

      let product: CustomerAgentProduct;
      let variant: CustomerAgentProductVariant;
      let pricingDecisionId: string | null;
      const currentItem = draft?.items[0] ?? null;
      if (draft && draft.items.length !== 1) {
        return finish(
          replyFor(
            language === 'ar'
              ? 'تعديل الطلبات متعددة العناصر يحتاج إلى موظف.'
              : language === 'fr'
                ? 'La modification d’une commande à plusieurs articles nécessite un conseiller.'
                : 'A multi-item order change needs a team member.',
            'handoff',
            {
              draftOrderId: draft.draftOrderId,
              handoffReason: 'multi_item_order_change',
            },
          ),
        );
      }

      const needsProductLookup =
        !currentItem ||
        requestsVariantChange(input.message.content) ||
        extractRequestedPrice(input.message.content) !== null;
      if (needsProductLookup) {
        const query =
          decision.query.length > 0
            ? decision.query
            : (currentItem?.productName ?? context.currentMessage);
        if (
          query.trim().length === 0 &&
          input.conversation.linkedProductId === null &&
          currentItem === null
        ) {
          return finish(replyFor(localText(language, 'ask_product'), 'clarification'));
        }
        const productsCall = await executeLocalTool(
          state,
          'search_products',
          {
            query,
            productId: currentItem?.productId ?? input.conversation.linkedProductId,
            limit: 5,
          },
          `${runId}:order-products`,
        );
        const products = customerAgentToolSchemas.searchProductsOutputSchema.parse(
          productsCall.output,
        ) as ProductSearchResult;
        if (products.items.length === 0) {
          return finish(replyFor(localText(language, 'not_found'), 'clarification'));
        }
        if (products.items.length > 1) {
          return finish(
            replyFor(
              `${localText(language, 'choose_product')} ${listNames(products.items)}`,
              'clarification',
            ),
          );
        }
        const selectedProduct = products.items[0];
        if (!selectedProduct) throw new Error('validated_product_missing');
        const selectedVariant = selectVariant(selectedProduct, input.message.content);
        if (!selectedVariant && currentItem && !requestsVariantChange(input.message.content)) {
          const existing = selectedProduct.variants.find(
            (candidate) => candidate.id === currentItem.variantId,
          );
          if (!existing) throw new Error('draft_variant_missing_from_product');
          product = selectedProduct;
          variant = existing;
        } else {
          if (!selectedVariant) {
            const variantNames = selectedProduct.variants.map((item) => ({
              name: item.name ?? item.sku,
            }));
            return finish(
              replyFor(
                `${localText(language, 'choose_variant')} ${listNames(variantNames)}`,
                'clarification',
                { productId: selectedProduct.id, draftOrderId: draft?.draftOrderId },
              ),
            );
          }
          product = selectedProduct;
          variant = selectedVariant;
        }
      } else {
        if (!currentItem) throw new Error('draft_item_missing');
        product = {
          id: currentItem.productId,
          code: '',
          name: currentItem.productName,
          description: null,
          customAttributes: {},
          variants: [],
        };
        variant = {
          id: currentItem.variantId,
          sku: currentItem.sku,
          name: currentItem.variantName,
          attributes: {},
        };
      }

      const quantity =
        extractRequestedQuantity(input.message.content) ??
        currentItem?.quantity ??
        decision.requestedQuantity;
      pricingDecisionId =
        currentItem?.variantId === variant.id ? (currentItem.pricingDecisionId ?? null) : null;

      const availabilityCall = await executeLocalTool(
        state,
        'get_variant_availability',
        { variantId: variant.id, quantity },
        `${runId}:order-availability`,
      );
      const availability = customerAgentToolSchemas.availabilityOutputSchema.parse(
        availabilityCall.output,
      ) as VariantAvailabilityResult;
      if (!availability.available) {
        return finish(
          replyFor(orderText(language, 'out_of_stock'), 'clarification', {
            productId: product.id,
            variantId: variant.id,
            draftOrderId: draft?.draftOrderId,
          }),
        );
      }

      const requestedPrice = extractRequestedPrice(input.message.content);
      if (requestedPrice !== null) {
        const offerCall = await executeLocalTool(
          state,
          'evaluate_price_offer',
          {
            productId: product.id,
            variantId: variant.id,
            requestedPrice,
          },
          `${runId}:price-offer`,
        );
        const offer = customerAgentToolSchemas.evaluatePriceOfferOutputSchema.parse(
          offerCall.output,
        ) as PriceOfferResult;
        if (offer.outcome === 'accept' && offer.pricingDecisionId && offer.decidedPrice) {
          pricingDecisionId = offer.pricingDecisionId;
        } else {
          const handoff = offer.outcome === 'handoff';
          return finish(
            replyFor(
              negotiationText(offer, product, variant, language),
              handoff ? 'handoff' : 'clarification',
              {
                productId: product.id,
                variantId: variant.id,
                draftOrderId: draft?.draftOrderId,
                handoffReason: handoff ? 'pricing_policy_handoff' : null,
              },
            ),
          );
        }
      } else if (!currentItem || currentItem.variantId !== variant.id) {
        const priceCall = await executeLocalTool(
          state,
          'get_effective_price',
          { productId: product.id, variantId: variant.id },
          `${runId}:order-price`,
        );
        const price = customerAgentToolSchemas.effectivePriceOutputSchema.parse(
          priceCall.output,
        ) as EffectivePriceResult;
        pricingDecisionId = price.pricingDecisionId;
      }

      const mutationCall = await executeLocalTool(
        state,
        'create_or_update_draft_order',
        {
          draftOrderId: draft?.draftOrderId ?? null,
          expectedVersion: draft?.version ?? null,
          variantId: variant.id,
          quantity,
          pricingDecisionId,
          customerPhone: extractCustomerPhone(input.message.content),
          shippingAddress: extractShippingAddress(input.message.content),
        },
        `${runId}:draft-save`,
      );
      const mutation = customerAgentToolSchemas.draftMutationOutputSchema.parse(
        mutationCall.output,
      ) as DraftMutationResult;
      if (mutation.outcome !== 'saved' || !mutation.draft) {
        const text =
          mutation.outcome === 'out_of_stock'
            ? orderText(language, 'out_of_stock')
            : orderText(language, 'stale');
        return finish(
          replyFor(text, 'clarification', {
            productId: product.id,
            variantId: variant.id,
            draftOrderId: draft?.draftOrderId,
          }),
        );
      }
      draft = mutation.draft;
      if (draft.missingFields.includes('customer_phone')) {
        return finish(
          replyFor(orderText(language, 'ask_phone'), 'clarification', {
            productId: product.id,
            variantId: variant.id,
            draftOrderId: draft.draftOrderId,
          }),
        );
      }
      if (draft.missingFields.includes('shipping_address')) {
        return finish(
          replyFor(orderText(language, 'ask_address'), 'clarification', {
            productId: product.id,
            variantId: variant.id,
            draftOrderId: draft.draftOrderId,
          }),
        );
      }
      if (draft.status === 'draft') {
        const submittedCall = await executeLocalTool(
          state,
          'submit_draft_order',
          { draftOrderId: draft.draftOrderId, expectedVersion: draft.version },
          `${runId}:draft-submit`,
        );
        const submitted = customerAgentToolSchemas.draftMutationOutputSchema.parse(
          submittedCall.output,
        ) as DraftMutationResult;
        if (submitted.outcome !== 'saved' || !submitted.draft) {
          const text =
            submitted.outcome === 'out_of_stock'
              ? orderText(language, 'out_of_stock')
              : orderText(language, 'stale');
          return finish(
            replyFor(text, 'clarification', {
              productId: product.id,
              variantId: variant.id,
              draftOrderId: draft.draftOrderId,
            }),
          );
        }
        draft = submitted.draft;
      }
      if (!draft.readyForConfirmation || draft.status !== 'awaiting_confirmation') {
        return finish(
          replyFor(orderText(language, 'cannot_confirm'), 'clarification', {
            productId: product.id,
            variantId: variant.id,
            draftOrderId: draft.draftOrderId,
          }),
        );
      }
      return finish(
        replyFor(draftSummary(draft, language), 'reply', {
          productId: product.id,
          variantId: variant.id,
          draftOrderId: draft.draftOrderId,
        }),
      );
    } catch (error) {
      if (error instanceof AiToolExecutionError) state.traces.push(error.trace);
      const reason: AiHandoffReason =
        error instanceof AiToolExecutionError && error.trace.status === 'rejected'
          ? 'tool_rejected'
          : 'tool_failed';
      return finish(
        createReply({
          runId,
          decision: { ...decision, route: 'handoff' },
          status: 'handoff',
          text: localText(language, 'tool_failure'),
          traces: state.traces,
          evidence: evidenceFromTraces(state.traces),
          groundingValidated: false,
          handoffReason: reason,
          draftOrderId: input.conversation.linkedDraftOrderId,
          orderId: input.conversation.linkedOrderId,
        }),
        reason,
      );
    }
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
    let decision = routeCustomerIntent(message.content);
    if (
      input.conversation.linkedDraftOrderId &&
      decision.route !== 'handoff' &&
      decision.reason !== 'order_confirm' &&
      decision.reason !== 'order_cancel' &&
      (extractCustomerPhone(message.content) !== null ||
        extractShippingAddress(message.content) !== null ||
        extractRequestedQuantity(message.content) !== null ||
        extractRequestedPrice(message.content) !== null ||
        isAmbiguousOrderAffirmation(message.content))
    ) {
      decision = {
        ...decision,
        intent: 'order_draft',
        route: 'direct_query',
        reason: 'order_update',
      };
    }
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

    if (decision.intent === 'order_draft' || decision.intent === 'order_confirmation') {
      const result = await this.#order(
        context,
        decision,
        {
          tenantId: input.tenantId,
          conversation: input.conversation,
          correlationId: input.correlationId,
          message,
        },
        registry,
        startedAt,
      );
      return result.reply;
    }

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
