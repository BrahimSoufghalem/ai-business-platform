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
  readonly linkedProductId: string | null;
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
  readonly rule: {
    readonly ruleSetId: string;
    readonly ruleVersionId: string;
    readonly version: number;
  } | null;
  readonly observedAt: string;
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
  getBusinessRules(
    context: CustomerAgentDataContext,
    input: { readonly scope: 'pricing' | 'general' },
  ): Promise<BusinessRulesResult>;
  findKnowledge(
    context: CustomerAgentDataContext,
    input: { readonly query: string; readonly limit: number },
  ): Promise<KnowledgeSearchResult>;
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

export type CustomerAgentClaimKind = 'product' | 'price' | 'availability' | 'knowledge' | 'rule';

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
