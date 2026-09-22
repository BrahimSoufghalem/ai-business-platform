import { z } from 'zod';

const uuidSchema = z.string().uuid();
const quantitySchema = z.number().int().positive().max(1_000_000_000);
const idempotencyKeySchema = z.string().trim().min(8).max(128);
const referenceTypeSchema = z.string().trim().min(1).max(64);
const referenceIdSchema = z.string().trim().min(1).max(255);

const optionalReference = {
  referenceType: referenceTypeSchema.optional(),
  referenceId: referenceIdSchema.optional(),
};

function referencePair<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).superRefine((value, context) => {
    const candidate = value as {
      referenceType?: string;
      referenceId?: string;
    };
    if ((candidate.referenceType === undefined) !== (candidate.referenceId === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'referenceType and referenceId must be provided together.',
        path: candidate.referenceType === undefined ? ['referenceType'] : ['referenceId'],
      });
    }
  });
}

export const inventoryEntityIdSchema = uuidSchema;

export const createInventoryLocationSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(120),
  isDefault: z.boolean().default(false),
});

export const balanceQuerySchema = z.object({
  locationId: uuidSchema.optional(),
  variantId: uuidSchema.optional(),
  lowStock: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const movementQuerySchema = z.object({
  locationId: uuidSchema.optional(),
  variantId: uuidSchema.optional(),
  type: z.enum(['receive', 'adjust', 'reserve', 'release', 'sell', 'return']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const reservationQuerySchema = z.object({
  status: z.enum(['active', 'released', 'committed', 'expired']).optional(),
  referenceType: referenceTypeSchema.optional(),
  referenceId: referenceIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const receiveInventorySchema = referencePair({
  locationId: uuidSchema,
  variantId: uuidSchema,
  quantity: quantitySchema,
  idempotencyKey: idempotencyKeySchema,
  reason: z.string().trim().min(1).max(500).optional(),
  ...optionalReference,
});

export const adjustInventorySchema = z.object({
  locationId: uuidSchema,
  variantId: uuidSchema,
  quantityDelta: z
    .number()
    .int()
    .min(-1_000_000_000)
    .max(1_000_000_000)
    .refine((value) => value !== 0),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: idempotencyKeySchema,
});

export const sellInventorySchema = referencePair({
  locationId: uuidSchema,
  variantId: uuidSchema,
  quantity: quantitySchema,
  idempotencyKey: idempotencyKeySchema,
  ...optionalReference,
});

export const returnInventorySchema = referencePair({
  locationId: uuidSchema,
  variantId: uuidSchema,
  quantity: quantitySchema,
  idempotencyKey: idempotencyKeySchema,
  reason: z.string().trim().min(1).max(500).optional(),
  ...optionalReference,
});

export const reserveInventorySchema = z.object({
  locationId: uuidSchema,
  variantId: uuidSchema,
  quantity: quantitySchema,
  referenceType: referenceTypeSchema,
  referenceId: referenceIdSchema,
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .nullable()
    .optional(),
  idempotencyKey: idempotencyKeySchema,
});

export const releaseReservationSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  reason: z.string().trim().min(1).max(500).optional(),
});

export const commitReservationSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
});

export const setReorderPointSchema = z.object({
  locationId: uuidSchema,
  variantId: uuidSchema,
  reorderPoint: z.number().int().min(0).max(1_000_000_000),
});

export type CreateInventoryLocationInput = z.infer<typeof createInventoryLocationSchema>;
export type BalanceQueryInput = z.infer<typeof balanceQuerySchema>;
export type MovementQueryInput = z.infer<typeof movementQuerySchema>;
export type ReservationQueryInput = z.infer<typeof reservationQuerySchema>;
export type ReceiveInventoryInput = z.infer<typeof receiveInventorySchema>;
export type AdjustInventoryInput = z.infer<typeof adjustInventorySchema>;
export type SellInventoryInput = z.infer<typeof sellInventorySchema>;
export type ReturnInventoryInput = z.infer<typeof returnInventorySchema>;
export type ReserveInventoryInput = z.infer<typeof reserveInventorySchema>;
export type ReleaseReservationInput = z.infer<typeof releaseReservationSchema>;
export type CommitReservationInput = z.infer<typeof commitReservationSchema>;
export type SetReorderPointInput = z.infer<typeof setReorderPointSchema>;
