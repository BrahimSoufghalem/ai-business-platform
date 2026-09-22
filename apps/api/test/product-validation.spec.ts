import { describe, expect, it } from 'vitest';
import { getProductTypeTemplate, validateAttributeDefinitions } from '@ai-business/domain';
import { createMediaTicketSchema, productSearchSchema } from '../src/products/product.schemas.js';
import { validateProductConfiguration } from '../src/products/product-validation.js';

const smartphone = getProductTypeTemplate('smartphone');
if (!smartphone) throw new Error('Smartphone template is missing.');
const definitions = validateAttributeDefinitions(smartphone.attributes);

describe('product configuration', () => {
  it('allows an incomplete draft but requires variants before publishing', () => {
    expect(
      validateProductConfiguration({
        definitions,
        lifecycleStatus: 'draft',
        code: 'phone-1',
        basePrice: '120000',
        customAttributes: {},
        variants: [],
      }),
    ).toMatchObject({ code: 'PHONE-1', basePrice: '120000.00' });

    expect(() =>
      validateProductConfiguration({
        definitions,
        lifecycleStatus: 'active',
        code: 'phone-1',
        basePrice: '120000',
        customAttributes: { ram_gb: 8 },
        variants: [],
      }),
    ).toThrow('requires at least one sellable variant');
  });

  it('validates and deduplicates variant combinations', () => {
    const variant = {
      sku: 'phone-black-128',
      name: 'Black / 128 GB',
      attributes: { storage: '128 GB', color: 'Black' },
      status: 'active' as const,
    };
    expect(
      validateProductConfiguration({
        definitions,
        lifecycleStatus: 'active',
        code: 'phone-1',
        basePrice: '120000',
        customAttributes: { ram_gb: 8 },
        variants: [variant],
      }).variants[0],
    ).toMatchObject({ sku: 'PHONE-BLACK-128', attributes: variant.attributes });

    expect(() =>
      validateProductConfiguration({
        definitions,
        lifecycleStatus: 'active',
        code: 'phone-1',
        basePrice: '120000',
        customAttributes: { ram_gb: 8 },
        variants: [variant, { ...variant, sku: 'another-sku' }],
      }),
    ).toThrow('combinations must be unique');
  });

  it('parses search limits and restricts media content types', () => {
    expect(productSearchSchema.parse({ limit: '25' }).limit).toBe(25);
    expect(() =>
      createMediaTicketSchema.parse({ filename: 'payload.svg', contentType: 'image/svg+xml' }),
    ).toThrow();
  });
});
