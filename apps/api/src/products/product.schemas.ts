import { z } from 'zod';

const moneySchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/);
const customAttributesSchema = z.record(z.string(), z.unknown());

const variantSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120).nullable().optional(),
  attributes: customAttributesSchema.default({}),
  priceOverride: moneySchema.nullable().optional(),
  status: z.enum(['active', 'archived']).default('active'),
});

export const productIdSchema = z.string().uuid();
export const mediaIdSchema = z.string().uuid();

export const createProductSchema = z.object({
  productTypeId: z.string().uuid(),
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(5000).nullable().optional(),
  basePrice: moneySchema,
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .default('DZD'),
  status: z.enum(['draft', 'active']).default('draft'),
  customAttributes: customAttributesSchema.default({}),
  variants: z.array(variantSchema).max(200).default([]),
});

export const updateProductSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    productTypeId: z.string().uuid().optional(),
    code: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(2).max(160).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    basePrice: moneySchema.optional(),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase())
      .optional(),
    customAttributes: customAttributesSchema.optional(),
    variants: z.array(variantSchema).max(200).optional(),
    publish: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.productTypeId !== undefined ||
      value.code !== undefined ||
      value.name !== undefined ||
      value.description !== undefined ||
      value.basePrice !== undefined ||
      value.currency !== undefined ||
      value.customAttributes !== undefined ||
      value.variants !== undefined ||
      value.publish !== undefined,
    { message: 'Provide at least one field to update.' },
  );

export const productSearchSchema = z.object({
  q: z.string().trim().max(100).default(''),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  productTypeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const contentLinkSchema = z.object({
  channel: z.enum(['instagram', 'internal']),
  externalContentId: z.string().trim().min(1).max(255),
  productId: z.string().uuid(),
});

export const contentResolveSchema = z.object({
  channel: z.enum(['instagram', 'internal']),
  externalContentId: z.string().trim().min(1).max(255),
});

export const createMediaTicketSchema = z.object({
  filename: z.string().trim().min(1).max(180),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  altText: z.string().trim().max(250).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

export const uploadProductMediaSchema = createMediaTicketSchema.extend({
  dataBase64: z
    .string()
    .min(4)
    .max(7_000_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductSearchInput = z.infer<typeof productSearchSchema>;
export type ContentLinkInput = z.infer<typeof contentLinkSchema>;
export type CreateMediaTicketInput = z.infer<typeof createMediaTicketSchema>;
export type UploadProductMediaInput = z.infer<typeof uploadProductMediaSchema>;
