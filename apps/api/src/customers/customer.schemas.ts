import { z } from 'zod';

const metadataSchema = z.record(z.string(), z.unknown());

export const customerEntityIdSchema = z.string().uuid();

export const customerContactSchema = z.object({
  type: z.enum(['phone', 'email', 'whatsapp', 'instagram']),
  value: z.string().trim().min(1).max(254),
  label: z.string().trim().min(1).max(80).nullable().optional(),
  isPrimary: z.boolean().default(false),
});

export const customerAddressSchema = z.object({
  label: z.string().trim().min(1).max(80).nullable().optional(),
  recipientName: z.string().trim().min(2).max(160).nullable().optional(),
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
  isDefault: z.boolean().default(false),
});

function hasSinglePrimaryPerType(
  contacts: readonly z.infer<typeof customerContactSchema>[],
): boolean {
  const primaryTypes = contacts
    .filter((contact) => contact.isPrimary)
    .map((contact) => contact.type);
  return new Set(primaryTypes).size === primaryTypes.length;
}

export const createCustomerSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    contacts: z.array(customerContactSchema).min(1).max(12),
    addresses: z.array(customerAddressSchema).max(12).default([]),
    metadata: metadataSchema.default({}),
  })
  .refine((value) => hasSinglePrimaryPerType(value.contacts), {
    message: 'Only one primary contact is allowed per type.',
    path: ['contacts'],
  });

export const updateCustomerSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    name: z.string().trim().min(2).max(160).optional(),
    status: z.enum(['active', 'archived']).optional(),
    contacts: z.array(customerContactSchema).min(1).max(12).optional(),
    addresses: z.array(customerAddressSchema).max(12).optional(),
    metadata: metadataSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.status !== undefined ||
      value.contacts !== undefined ||
      value.addresses !== undefined ||
      value.metadata !== undefined,
    { message: 'Provide at least one customer field to update.' },
  )
  .refine((value) => !value.contacts || hasSinglePrimaryPerType(value.contacts), {
    message: 'Only one primary contact is allowed per type.',
    path: ['contacts'],
  });

export const customerSearchSchema = z.object({
  status: z.enum(['active', 'archived']).optional(),
  q: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createCustomerNoteSchema = z.object({
  body: z.string().trim().min(2).max(4000),
});

export type CustomerContactInput = z.infer<typeof customerContactSchema>;
export type CustomerAddressInput = z.infer<typeof customerAddressSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type CustomerSearchInput = z.infer<typeof customerSearchSchema>;
export type CreateCustomerNoteInput = z.infer<typeof createCustomerNoteSchema>;
