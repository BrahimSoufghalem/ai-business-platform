import { z } from 'zod';

const uuidSchema = z.string().uuid();
const moneySchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/);
const changeNoteSchema = z.string().trim().min(2).max(500).nullable().optional();

function hasUnsupportedControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    );
  });
}

const minimumPriceSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('fixed'),
      amount: moneySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('percentage_of_list'),
      percentage: z.number().min(0).max(100),
    })
    .strict(),
]);

export const pricingPolicySchema = z
  .object({
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/)
      .transform((value) => value.toUpperCase()),
    negotiable: z.boolean(),
    minimumPrice: minimumPriceSchema,
    maxDiscountPercent: z.number().min(0).max(100),
    escalation: z
      .object({
        belowMinimum: z.enum(['counter', 'handoff', 'reject']),
        whenNotNegotiable: z.enum(['handoff', 'reject']),
        maxCounterOffers: z.number().int().min(0).max(10),
      })
      .strict(),
  })
  .strict();

export const configurationEntityIdSchema = uuidSchema;

export const createRuleSetSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9][a-z0-9_-]*$/)
      .transform((value) => value.toLowerCase()),
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().min(2).max(500).nullable().optional(),
    policy: pricingPolicySchema,
    changeNote: changeNoteSchema,
  })
  .strict();

export const saveRuleDraftSchema = z
  .object({
    expectedSetVersion: z.number().int().positive(),
    policy: pricingPolicySchema,
    changeNote: changeNoteSchema,
  })
  .strict();

export const publishRuleVersionSchema = z
  .object({
    expectedSetVersion: z.number().int().positive(),
  })
  .strict();

export const evaluatePriceSchema = z
  .object({
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/)
      .transform((value) => value.toUpperCase()),
    listPrice: moneySchema,
    requestedPrice: moneySchema,
    productId: uuidSchema.nullable().optional(),
    variantId: uuidSchema.nullable().optional(),
    conversationId: uuidSchema.nullable().optional(),
  })
  .strict();

const safeContentSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => !hasUnsupportedControlCharacters(value),
    'Unsupported control characters are not allowed.',
  );

export const createKnowledgeEntrySchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9_-]*$/)
      .transform((value) => value.toLowerCase()),
    kind: z.enum(['faq', 'article', 'policy']),
    title: safeContentSchema.max(200),
    question: safeContentSchema.max(500).nullable().optional(),
    content: safeContentSchema.max(20_000),
    changeNote: changeNoteSchema,
  })
  .strict();

export const saveKnowledgeDraftSchema = z
  .object({
    expectedEntryVersion: z.number().int().positive(),
    title: safeContentSchema.max(200),
    question: safeContentSchema.max(500).nullable().optional(),
    content: safeContentSchema.max(20_000),
    changeNote: changeNoteSchema,
  })
  .strict();

export const publishKnowledgeVersionSchema = z
  .object({
    expectedEntryVersion: z.number().int().positive(),
  })
  .strict();

export const knowledgeSearchSchema = z.object({
  q: z.string().trim().min(1).max(200),
  kind: z.enum(['faq', 'article', 'policy']).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export const listConfigurationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const saveAgentSettingsDraftSchema = z
  .object({
    expectedLatestVersion: z.number().int().nonnegative(),
    language: z.enum(['ar', 'fr', 'en']),
    tone: z.enum(['professional', 'friendly', 'concise', 'warm']),
    handoffNotes: safeContentSchema.max(1000).or(z.literal('')),
    changeNote: changeNoteSchema,
  })
  .strict();

export const publishAgentSettingsSchema = z
  .object({
    expectedLatestVersion: z.number().int().positive(),
  })
  .strict();

export type PricingPolicyInput = z.infer<typeof pricingPolicySchema>;
export type CreateRuleSetInput = z.infer<typeof createRuleSetSchema>;
export type SaveRuleDraftInput = z.infer<typeof saveRuleDraftSchema>;
export type PublishRuleVersionInput = z.infer<typeof publishRuleVersionSchema>;
export type EvaluatePriceInput = z.infer<typeof evaluatePriceSchema>;
export type CreateKnowledgeEntryInput = z.infer<typeof createKnowledgeEntrySchema>;
export type SaveKnowledgeDraftInput = z.infer<typeof saveKnowledgeDraftSchema>;
export type PublishKnowledgeVersionInput = z.infer<typeof publishKnowledgeVersionSchema>;
export type KnowledgeSearchInput = z.infer<typeof knowledgeSearchSchema>;
export type ListConfigurationInput = z.infer<typeof listConfigurationSchema>;
export type SaveAgentSettingsDraftInput = z.infer<typeof saveAgentSettingsDraftSchema>;
export type PublishAgentSettingsInput = z.infer<typeof publishAgentSettingsSchema>;
