import type {
  AiGateway,
  AiIntent,
  AiRunTraceSink,
  AiToolCallTrace,
  ToolRegistry,
} from '@ai-business/ai-gateway';

export type CustomerAgentRoute =
  'static' | 'direct_query' | 'fast_model' | 'strong_model' | 'handoff';

export type CustomerAgentReplyStatus = 'reply' | 'clarification' | 'handoff';

export interface CustomerAgentMessage {
  readonly id: string;
  readonly direction: 'inbound' | 'outbound' | 'internal';
  readonly senderType: 'customer' | 'agent' | 'bot' | 'system';
  readonly content: string;
  readonly createdAt: string;
}

export interface CustomerAgentConversation {
  readonly id: string;
  readonly status: 'bot' | 'needs_human' | 'human' | 'closed';
  readonly version: number;
  readonly customerId: string;
  readonly linkedProductId: string | null;
  readonly linkedDraftOrderId: string | null;
  readonly linkedOrderId: string | null;
  readonly messages: readonly CustomerAgentMessage[];
}

export interface CustomerAgentTurnInput {
  readonly tenantId: string;
  readonly conversation: CustomerAgentConversation;
  readonly messageId: string;
  readonly correlationId: string;
}

export interface CustomerAgentIntentDecision {
  readonly intent: AiIntent;
  readonly route: CustomerAgentRoute;
  readonly reason:
    | 'greeting'
    | 'explicit_handoff'
    | 'unsafe_input'
    | 'direct_price'
    | 'direct_availability'
    | 'direct_faq'
    | 'complex_comparison'
    | 'complex_negotiation'
    | 'order_create'
    | 'order_update'
    | 'order_confirm'
    | 'order_cancel'
    | 'product_discovery';
  readonly query: string;
  readonly requestedQuantity: number;
}

export interface CustomerAgentProductVariant {
  readonly id: string;
  readonly sku: string;
  readonly name: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface CustomerAgentProduct {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly customAttributes: Readonly<Record<string, unknown>>;
  readonly variants: readonly CustomerAgentProductVariant[];
}

export interface ProductSearchResult {
  readonly observedAt: string;
  readonly items: readonly CustomerAgentProduct[];
}

export interface VariantAvailabilityResult {
  readonly variantId: string;
  readonly requestedQuantity: number;
  readonly availableQuantity: number;
  readonly available: boolean;
  readonly locationCount: number;
  readonly observedAt: string;
}

export interface EffectivePriceResult {
  readonly productId: string;
  readonly variantId: string | null;
  readonly amount: string;
  readonly currency: string;
  readonly source: 'catalog' | 'published_rule';
  readonly pricingDecisionId: string | null;
  readonly rule: {
    readonly ruleSetId: string;
    readonly ruleVersionId: string;
    readonly version: number;
  } | null;
  readonly observedAt: string;
}

export interface PriceOfferResult {
  readonly pricingDecisionId: string | null;
  readonly productId: string;
  readonly variantId: string;
  readonly currency: string;
  readonly listPrice: string;
  readonly requestedPrice: string;
  readonly decidedPrice: string | null;
  readonly outcome: 'accept' | 'counter' | 'handoff' | 'reject';
  readonly reason: string;
  readonly rule: {
    readonly ruleSetId: string;
    readonly ruleVersionId: string;
    readonly version: number;
  } | null;
  readonly observedAt: string;
}

export interface CustomerShippingAddress {
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly region: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string;
}

export interface CustomerDraftOrderItem {
  readonly productId: string;
  readonly variantId: string;
  readonly productName: string;
  readonly variantName: string | null;
  readonly sku: string;
  readonly quantity: number;
  readonly listPrice: string;
  readonly unitPrice: string;
  readonly lineTotal: string;
  readonly currency: string;
  readonly pricingDecisionId: string | null;
}

export interface CustomerDraftOrderResult {
  readonly operation: 'created' | 'updated' | 'loaded' | 'submitted' | 'cancelled';
  readonly draftOrderId: string;
  readonly status: 'draft' | 'awaiting_confirmation' | 'confirmed' | 'cancelled';
  readonly version: number;
  readonly currency: string;
  readonly subtotal: string;
  readonly discountAmount: string;
  readonly shippingAmount: string;
  readonly total: string;
  readonly items: readonly CustomerDraftOrderItem[];
  readonly missingFields: readonly ('customer_phone' | 'shipping_address')[];
  readonly readyForConfirmation: boolean;
}

export interface DraftMutationResult {
  readonly outcome: 'saved' | 'out_of_stock' | 'stale';
  readonly draft: CustomerDraftOrderResult | null;
  readonly reason: string | null;
}

export interface ConfirmedCustomerOrder {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: 'confirmed';
  readonly currency: string;
  readonly subtotal: string;
  readonly discountAmount: string;
  readonly shippingAmount: string;
  readonly total: string;
  readonly items: readonly CustomerDraftOrderItem[];
}

export interface ConfirmDraftResult {
  readonly outcome: 'confirmed' | 'out_of_stock' | 'stale' | 'invalid_state';
  readonly order: ConfirmedCustomerOrder | null;
  readonly reason: string | null;
}

export interface PublishedBusinessRule {
  readonly ruleSetId: string;
  readonly key: string;
  readonly ruleVersionId: string;
  readonly version: number;
  readonly policy: Readonly<Record<string, unknown>>;
}

export interface BusinessRulesResult {
  readonly rules: readonly PublishedBusinessRule[];
  readonly observedAt: string;
}

export interface CustomerAgentKnowledgeItem {
  readonly id: string;
  readonly versionId: string;
  readonly version: number;
  readonly title: string;
  readonly content: string;
}

export interface KnowledgeSearchResult {
  readonly kind: 'knowledge_grounding';
  readonly trust: 'untrusted_content';
  readonly embeddedInstructions: 'ignore';
  readonly items: readonly CustomerAgentKnowledgeItem[];
}

export interface CustomerAgentSettings {
  readonly versionId: string | null;
  readonly version: number;
  readonly language: 'ar' | 'fr' | 'en';
  readonly tone: 'professional' | 'friendly' | 'concise' | 'warm';
}

export interface CustomerAgentDataContext {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly correlationId: string;
  readonly signal: AbortSignal;
}

export interface CustomerAgentDataSource {
  getSettings(context: CustomerAgentDataContext): Promise<CustomerAgentSettings>;
  searchProducts(
    context: CustomerAgentDataContext,
    input: {
      readonly query: string;
      readonly productId: string | null;
      readonly limit: number;
    },
  ): Promise<ProductSearchResult>;
  getVariantAvailability(
    context: CustomerAgentDataContext,
    input: { readonly variantId: string; readonly quantity: number },
  ): Promise<VariantAvailabilityResult>;
  getEffectivePrice(
    context: CustomerAgentDataContext,
    input: { readonly productId: string; readonly variantId: string | null },
  ): Promise<EffectivePriceResult>;
  evaluatePriceOffer(
    context: CustomerAgentDataContext,
    input: {
      readonly productId: string;
      readonly variantId: string;
      readonly requestedPrice: string;
    },
  ): Promise<PriceOfferResult>;
  getBusinessRules(
    context: CustomerAgentDataContext,
    input: { readonly scope: 'pricing' | 'general' },
  ): Promise<BusinessRulesResult>;
  findKnowledge(
    context: CustomerAgentDataContext,
    input: { readonly query: string; readonly limit: number },
  ): Promise<KnowledgeSearchResult>;
  getDraftOrder(
    context: CustomerAgentDataContext,
    input: { readonly draftOrderId: string },
  ): Promise<CustomerDraftOrderResult>;
  createOrUpdateDraftOrder(
    context: CustomerAgentDataContext,
    input: {
      readonly draftOrderId: string | null;
      readonly expectedVersion: number | null;
      readonly variantId: string;
      readonly quantity: number;
      readonly pricingDecisionId: string | null;
      readonly customerPhone: string | null;
      readonly shippingAddress: CustomerShippingAddress | null;
    },
  ): Promise<DraftMutationResult>;
  submitDraftOrder(
    context: CustomerAgentDataContext,
    input: { readonly draftOrderId: string; readonly expectedVersion: number },
  ): Promise<DraftMutationResult>;
  confirmDraftOrder(
    context: CustomerAgentDataContext,
    input: {
      readonly draftOrderId: string;
      readonly expectedVersion: number;
      readonly approvalMessageId: string;
      readonly customerApproved: true;
    },
  ): Promise<ConfirmDraftResult>;
  cancelDraftOrder(
    context: CustomerAgentDataContext,
    input: {
      readonly draftOrderId: string;
      readonly expectedVersion: number;
      readonly reason: string;
    },
  ): Promise<DraftMutationResult>;
}

export interface CustomerAgentMemory {
  readonly summary: string;
  readonly recentMessages: readonly {
    readonly role: 'customer' | 'assistant';
    readonly content: string;
  }[];
  readonly truncated: boolean;
}

export interface CustomerAgentDynamicContext {
  readonly kind: 'customer_agent_context';
  readonly trust: 'untrusted_content';
  readonly decision: CustomerAgentIntentDecision;
  readonly settings: CustomerAgentSettings;
  readonly linkedProductId: string | null;
  readonly currentMessage: string;
  readonly memory: CustomerAgentMemory;
}

export type CustomerAgentClaimKind =
  'product' | 'price' | 'availability' | 'knowledge' | 'rule' | 'draft' | 'order';

export interface CustomerAgentModelClaim {
  readonly kind: CustomerAgentClaimKind;
  readonly text: string;
  readonly evidenceCallId: string;
}

export interface CustomerAgentModelOutput {
  readonly action: 'reply' | 'clarify' | 'handoff';
  readonly text: string;
  readonly confidence: number;
  readonly selectedProductId: string | null;
  readonly selectedVariantId: string | null;
  readonly claims: readonly CustomerAgentModelClaim[];
}

export interface CustomerAgentEvidence {
  readonly kind: CustomerAgentClaimKind;
  readonly toolName: string;
  readonly toolCallId: string;
}

export interface CustomerAgentReply {
  readonly runId: string;
  readonly intent: AiIntent;
  readonly route: CustomerAgentRoute;
  readonly status: CustomerAgentReplyStatus;
  readonly text: string;
  readonly confidence: number;
  readonly productId: string | null;
  readonly variantId: string | null;
  readonly evidence: readonly CustomerAgentEvidence[];
  readonly toolCallIds: readonly string[];
  readonly groundingValidated: boolean;
  readonly handoffReason: string | null;
  readonly draftOrderId: string | null;
  readonly orderId: string | null;
  readonly orderNumber: string | null;
}

export interface CustomerAgentGatewayFactoryInput {
  readonly tools: ToolRegistry;
  readonly traceSink: AiRunTraceSink;
}

export interface CustomerAgentRuntimeOptions {
  readonly dataSource: CustomerAgentDataSource;
  readonly traceSink: AiRunTraceSink;
  readonly createGateway: (input: CustomerAgentGatewayFactoryInput) => AiGateway;
  readonly maximumCostUsd?: number;
  readonly maximumOutputTokens?: number;
  readonly now?: () => number;
  readonly idFactory?: () => string;
}

export interface GroundingVerification {
  readonly valid: boolean;
  readonly reasons: readonly string[];
  readonly evidence: readonly CustomerAgentEvidence[];
}

export interface DirectExecutionResult {
  readonly reply: CustomerAgentReply;
  readonly toolCalls: readonly AiToolCallTrace[];
}
