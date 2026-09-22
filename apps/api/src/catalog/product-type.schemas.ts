import { z } from 'zod';

export const productTypeIdSchema = z.string().uuid();

const attributeDefinitionSchema = z.object({
  key: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(80),
  dataType: z.enum(['text', 'number', 'boolean', 'select', 'multi_select']),
  required: z.boolean().optional(),
  searchable: z.boolean().optional(),
  variantAxis: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
});

export const createProductTypeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]{0,63}$/),
  description: z.string().trim().max(500).nullable().optional(),
  templateKey: z
    .enum(['general', 'clothing', 'shoes', 'smartphone', 'laptop', 'headset'])
    .optional(),
  attributes: z.array(attributeDefinitionSchema).max(50).optional(),
});

export const updateProductTypeSchema = z
  .object({
    expectedSchemaVersion: z.number().int().positive(),
    name: z.string().trim().min(2).max(80).optional(),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{0,63}$/)
      .optional(),
    description: z.string().trim().max(500).nullable().optional(),
    attributes: z.array(attributeDefinitionSchema).max(50).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.slug !== undefined ||
      value.description !== undefined ||
      value.attributes !== undefined,
    { message: 'Provide at least one field to update.' },
  );

export type CreateProductTypeInput = z.infer<typeof createProductTypeSchema>;
export type UpdateProductTypeInput = z.infer<typeof updateProductTypeSchema>;
