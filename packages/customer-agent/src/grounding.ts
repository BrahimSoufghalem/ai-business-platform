import type { AiToolCallTrace } from '@ai-business/ai-gateway';
import { z } from 'zod';
import type {
  CustomerAgentClaimKind,
  CustomerAgentModelOutput,
  GroundingVerification,
} from './contracts.js';

const claimSchema = z
  .object({
    kind: z.enum(['product', 'price', 'availability', 'knowledge', 'rule']),
    text: z.string().trim().min(1).max(500),
    evidenceCallId: z.string().trim().min(1).max(200),
  })
  .strict();

export const customerAgentModelOutputSchema = z
  .object({
    action: z.enum(['reply', 'clarify', 'handoff']),
    text: z.string().trim().min(1).max(2_000),
    confidence: z.number().min(0).max(1),
    selectedProductId: z.string().uuid().nullable(),
    selectedVariantId: z.string().uuid().nullable(),
    claims: z.array(claimSchema).max(12),
  })
  .strict();

export const customerAgentModelOutputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['reply', 'clarify', 'handoff'] },
    text: { type: 'string', minLength: 1, maxLength: 2_000 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    selectedProductId: { type: ['string', 'null'], format: 'uuid' },
    selectedVariantId: { type: ['string', 'null'], format: 'uuid' },
    claims: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: {
            type: 'string',
            enum: ['product', 'price', 'availability', 'knowledge', 'rule'],
          },
          text: { type: 'string', minLength: 1, maxLength: 500 },
          evidenceCallId: { type: 'string', minLength: 1, maxLength: 200 },
        },
        required: ['kind', 'text', 'evidenceCallId'],
      },
    },
  },
  required: ['action', 'text', 'confidence', 'selectedProductId', 'selectedVariantId', 'claims'],
} as const;

const requiredToolByClaim: Readonly<Record<CustomerAgentClaimKind, string>> = {
  product: 'search_products',
  price: 'get_effective_price',
  availability: 'get_variant_availability',
  knowledge: 'find_knowledge',
  rule: 'get_business_rules',
};

function collectIds(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, result);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if ((key === 'id' || key.endsWith('Id')) && typeof item === 'string') result.add(item);
      collectIds(item, result);
    }
  }
  return result;
}

function hasPriceLanguage(text: string): boolean {
  return /(?:\d[\d\s.,]*)\s*(?:DZD|DA|دج|دينار|EUR|USD|€|\$)\b/iu.test(text);
}

function hasAvailabilityLanguage(text: string): boolean {
  return /(?:متوفر|متاح|كاين|نفد|غير\s+متوفر|disponible|indisponible|in\s+stock|out\s+of\s+stock)/iu.test(
    text,
  );
}

export function verifyGroundedCustomerOutput(
  output: CustomerAgentModelOutput,
  toolCalls: readonly AiToolCallTrace[],
): GroundingVerification {
  const reasons: string[] = [];
  const calls = new Map(
    toolCalls
      .filter((call) => call.status === 'succeeded')
      .map((call) => [call.providerCallId, call]),
  );
  const evidence = output.claims.flatMap((claim) => {
    const call = calls.get(claim.evidenceCallId);
    if (!call) {
      reasons.push(`missing_evidence:${claim.kind}`);
      return [];
    }
    const requiredTool = requiredToolByClaim[claim.kind];
    if (call.name !== requiredTool) {
      reasons.push(`wrong_evidence_tool:${claim.kind}`);
      return [];
    }
    return [{ kind: claim.kind, toolName: call.name, toolCallId: call.id }];
  });

  if (hasPriceLanguage(output.text) && !output.claims.some((claim) => claim.kind === 'price')) {
    reasons.push('ungrounded_price_text');
  }
  if (
    hasAvailabilityLanguage(output.text) &&
    !output.claims.some((claim) => claim.kind === 'availability')
  ) {
    reasons.push('ungrounded_availability_text');
  }

  const productOutputs = toolCalls
    .filter((call) => call.status === 'succeeded' && call.name === 'search_products')
    .map((call) => call.safeOutput);
  const observedProductIds = new Set<string>();
  for (const safeOutput of productOutputs) collectIds(safeOutput, observedProductIds);
  if (output.selectedProductId && !observedProductIds.has(output.selectedProductId)) {
    reasons.push('unobserved_product');
  }
  if (output.selectedVariantId && !observedProductIds.has(output.selectedVariantId)) {
    reasons.push('unobserved_variant');
  }
  if (output.selectedVariantId && !output.selectedProductId) {
    reasons.push('variant_without_product');
  }
  if (output.action === 'reply' && output.confidence < 0.55) {
    reasons.push('reply_confidence_too_low');
  }

  return {
    valid: reasons.length === 0,
    reasons,
    evidence,
  };
}
