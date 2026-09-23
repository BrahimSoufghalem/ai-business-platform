import { z } from 'zod';

const uuidSchema = z.string().uuid();
const metadataSchema = z.record(z.string(), z.unknown());

export const conversationEntityIdSchema = uuidSchema;

export const conversationMessageSchema = z.object({
  direction: z.enum(['inbound', 'outbound', 'internal']),
  senderType: z.enum(['customer', 'agent', 'bot', 'system']),
  senderId: z.string().trim().min(1).max(200).nullable().optional(),
  externalId: z.string().trim().min(1).max(200).nullable().optional(),
  content: z.string().trim().min(1).max(20_000),
  metadata: metadataSchema.default({}),
});

export const createConversationSchema = z.object({
  customerId: uuidSchema,
  channel: z.enum(['internal', 'instagram', 'whatsapp', 'web', 'email']),
  externalThreadId: z.string().trim().min(1).max(200).nullable().optional(),
  status: z.enum(['bot', 'needs_human', 'human']).default('bot'),
  subject: z.string().trim().min(1).max(200).nullable().optional(),
  productId: uuidSchema.nullable().optional(),
  draftOrderId: uuidSchema.nullable().optional(),
  orderId: uuidSchema.nullable().optional(),
  initialMessage: conversationMessageSchema.optional(),
});

export const appendConversationMessageSchema = conversationMessageSchema;

export const conversationSearchSchema = z.object({
  status: z.enum(['bot', 'needs_human', 'human', 'closed']).optional(),
  channel: z.enum(['internal', 'instagram', 'whatsapp', 'web', 'email']).optional(),
  assignment: z.enum(['all', 'mine', 'unassigned']).default('all'),
  q: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const claimConversationSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export const releaseConversationSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(2).max(500),
});

export const transitionConversationSchema = z.object({
  expectedVersion: z.number().int().positive(),
  targetStatus: z.enum(['bot', 'needs_human', 'human', 'closed']),
  reason: z.string().trim().min(2).max(500).nullable().optional(),
});

export const updateConversationLinksSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    customerId: uuidSchema.optional(),
    productId: uuidSchema.nullable().optional(),
    draftOrderId: uuidSchema.nullable().optional(),
    orderId: uuidSchema.nullable().optional(),
    subject: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .refine(
    (value) =>
      value.customerId !== undefined ||
      value.productId !== undefined ||
      value.draftOrderId !== undefined ||
      value.orderId !== undefined ||
      value.subject !== undefined,
    { message: 'Provide at least one conversation link to update.' },
  );

export type ConversationMessageInput = z.infer<typeof conversationMessageSchema>;
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type ConversationSearchInput = z.infer<typeof conversationSearchSchema>;
export type ClaimConversationInput = z.infer<typeof claimConversationSchema>;
export type ReleaseConversationInput = z.infer<typeof releaseConversationSchema>;
export type TransitionConversationInput = z.infer<typeof transitionConversationSchema>;
export type UpdateConversationLinksInput = z.infer<typeof updateConversationLinksSchema>;
