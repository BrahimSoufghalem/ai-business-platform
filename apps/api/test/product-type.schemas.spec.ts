import { describe, expect, it } from 'vitest';
import {
  createProductTypeSchema,
  updateProductTypeSchema,
} from '../src/catalog/product-type.schemas.js';

describe('product type API schemas', () => {
  it('accepts a starter template request', () => {
    expect(
      createProductTypeSchema.parse({
        name: 'Smartphones',
        slug: 'smartphones',
        templateKey: 'smartphone',
      }),
    ).toMatchObject({ templateKey: 'smartphone' });
  });

  it('requires optimistic concurrency and a field to update', () => {
    expect(() => updateProductTypeSchema.parse({ expectedSchemaVersion: 1 })).toThrow();
    expect(
      updateProductTypeSchema.parse({ expectedSchemaVersion: 2, name: 'Mobile Phones' }),
    ).toMatchObject({ expectedSchemaVersion: 2 });
  });
});
