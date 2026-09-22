import { z } from 'zod';

const uuidSchema = z.string().uuid();
const idempotencyKeySchema = z.string().trim().min(8).max(128);
const customFieldsSchema = z.record(z.string(), z.unknown());

export const shippingAddressSchema = z.object({
  line1: z.string().trim().min(2).max(180),
  line2: z.string().trim().min(1).max(180).nullable().optional(),
  city: z.string().trim().min(2).max(100),
  region: z.string().trim().min(1).max(100).nullable().optional(),
  postalCode: z.string().trim().min(1).max(24).nullable().optional(),
  countryCode: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toUpperCase())
    .default('DZ'),
});

const customerPhoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 -]{6,19}$/)
  .transform((value) => value.replace(/[ -]/g, ''));

const draftItemSchema = z.object({
  variantId: uuidSchema,
  locationId: uuidSchema,
  quantity: z.number().int().positive().max(1_000_000),
});

export const orderEntityIdSchema = uuidSchema;

export const createDraftOrderSchema = z.object({
  customerId: uuidSchema.nullable().optional(),
  customerName: z.string().trim().min(2).max(160).nullable().optional(),
  customerPhone: customerPhoneSchema.nullable().optional(),
  customerEmail: z.string().trim().email().max(254).nullable().optional(),
  shippingAddress: shippingAddressSchema.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  customFields: customFieldsSchema.default({}),
  items: z.array(draftItemSchema).min(1).max(100),
});

export const updateDraftOrderSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    customerId: uuidSchema.nullable().optional(),
    customerName: z.string().trim().min(2).max(160).nullable().optional(),
    customerPhone: customerPhoneSchema.nullable().optional(),
    customerEmail: z.string().trim().email().max(254).nullable().optional(),
    shippingAddress: shippingAddressSchema.nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    customFields: customFieldsSchema.optional(),
    items: z.array(draftItemSchema).min(1).max(100).optional(),
  })
  .refine(
    (value) =>
      value.customerName !== undefined ||
      value.customerId !== undefined ||
      value.customerPhone !== undefined ||
      value.customerEmail !== undefined ||
      value.shippingAddress !== undefined ||
      value.notes !== undefined ||
      value.customFields !== undefined ||
      value.items !== undefined,
    { message: 'Provide at least one draft field to update.' },
  );

export const draftOrderSearchSchema = z.object({
  status: z.enum(['draft', 'awaiting_confirmation', 'confirmed', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const submitDraftOrderSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export const cancelDraftOrderSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500).optional(),
});

export const confirmDraftOrderSchema = z.object({
  expectedVersion: z.number().int().positive(),
  customerApproved: z.literal(true),
  approvalSource: z.enum(['customer_message', 'dashboard', 'internal_test']),
  idempotencyKey: idempotencyKeySchema,
});

export const orderSearchSchema = z.object({
  status: z.enum(['new', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled']).optional(),
  q: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const transitionOrderSchema = z.object({
  targetStatus: z.enum(['confirmed', 'preparing', 'shipped', 'delivered']),
  reason: z.string().trim().min(3).max(500).optional(),
  idempotencyKey: idempotencyKeySchema,
});

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: idempotencyKeySchema,
});

export type CreateDraftOrderInput = z.infer<typeof createDraftOrderSchema>;
export type UpdateDraftOrderInput = z.infer<typeof updateDraftOrderSchema>;
export type DraftOrderSearchInput = z.infer<typeof draftOrderSearchSchema>;
export type SubmitDraftOrderInput = z.infer<typeof submitDraftOrderSchema>;
export type CancelDraftOrderInput = z.infer<typeof cancelDraftOrderSchema>;
export type ConfirmDraftOrderInput = z.infer<typeof confirmDraftOrderSchema>;
export type OrderSearchInput = z.infer<typeof orderSearchSchema>;
export type TransitionOrderInput = z.infer<typeof transitionOrderSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
export type DraftItemInput = z.infer<typeof draftItemSchema>;
