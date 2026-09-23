import { describe, expect, it } from 'vitest';
import { parsePilotSeedManifest } from '../src/pilot-seed-manifest.js';

const manifest = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  identitySubject: 'pilot-owner',
  currency: 'DZD',
  productType: { name: 'Pilot products', slug: 'pilot-products' },
  location: { code: 'MAIN', name: 'Main stock', isDefault: true },
  products: [
    {
      code: 'PILOT-1',
      name: 'Pilot product',
      description: 'Safe synthetic catalog item',
      sku: 'PILOT-SKU-1',
      variantName: 'Default',
      price: 12_500,
      onHand: 8,
      reorderPoint: 2,
    },
  ],
};

describe('Pilot seed manifest', () => {
  it('accepts a bounded synthetic catalog manifest', () => {
    expect(parsePilotSeedManifest(manifest)).toMatchObject({
      tenantId: manifest.tenantId,
      currency: 'DZD',
      products: [{ code: 'PILOT-1', onHand: 8 }],
    });
  });

  it('rejects duplicate SKUs, PII-like free-form identifiers, and oversized imports', () => {
    expect(() =>
      parsePilotSeedManifest({
        ...manifest,
        products: [manifest.products[0], manifest.products[0]],
      }),
    ).toThrow('Product codes must be unique');
    expect(() =>
      parsePilotSeedManifest({
        ...manifest,
        products: [{ ...manifest.products[0], sku: 'contains spaces' }],
      }),
    ).toThrow('products[0].sku is invalid');
    expect(() =>
      parsePilotSeedManifest({
        ...manifest,
        products: Array.from({ length: 26 }, (_, index) => ({
          ...manifest.products[0],
          code: `P-${index}`,
          sku: `SKU-${index}`,
        })),
      }),
    ).toThrow('between 1 and 25');
  });

  it('rejects fields outside the bounded import contract', () => {
    expect(() =>
      parsePilotSeedManifest({
        ...manifest,
        customerNotes: 'must never be imported through the catalog seed',
      }),
    ).toThrow('manifest.customerNotes is not supported');
    expect(() =>
      parsePilotSeedManifest({
        ...manifest,
        products: [{ ...manifest.products[0], phone: '+213000000000' }],
      }),
    ).toThrow('products[0].phone is not supported');
  });
});
