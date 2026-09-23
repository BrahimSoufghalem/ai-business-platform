import { z } from 'zod';

export const customerAgentReplyRequestSchema = z
  .object({
    messageId: z.string().uuid(),
  })
  .strict();

const evidenceSchema = z
  .object({
    kind: z.enum(['product', 'price', 'availability', 'knowledge', 'rule', 'draft', 'order']),
    toolName: z.string().min(1).max(80),
    toolCallId: z.string().uuid(),
  })
  .strict();

export const storedCustomerAgentReplySchema = z
  .object({
    runId: z.string().uuid(),
    intent: z.enum([
      'faq',
      'product_discovery',
      'pricing',
      'order_draft',
      'order_confirmation',
      'order_status',
      'handoff',
      'summary',
    ]),
    route: z.enum(['static', 'direct_query', 'fast_model', 'strong_model', 'handoff']),
    status: z.enum(['reply', 'clarification', 'handoff']),
    text: z.string().min(1).max(2_000),
    confidence: z.number().min(0).max(1),
    productId: z.string().uuid().nullable(),
    variantId: z.string().uuid().nullable(),
    evidence: z.array(evidenceSchema).max(20),
    toolCallIds: z.array(z.string().uuid()).max(20),
    groundingValidated: z.boolean(),
    handoffReason: z.string().max(500).nullable(),
    draftOrderId: z.string().uuid().nullable(),
    orderId: z.string().uuid().nullable(),
    orderNumber: z.string().max(80).nullable(),
  })
  .strict();

export type CustomerAgentReplyRequest = z.infer<typeof customerAgentReplyRequestSchema>;
