import { describe, expect, it } from 'vitest';
import {
  canonicalizeAttributes,
  normalizeCatalogCode,
  normalizeMoneyAmount,
  validateAttributeDefinitions,
  validateProductLevelAttributes,
  validateVariantAttributes,
} from '../src/index.js';

describe('product catalog values', () => {
  const definitions = validateAttributeDefinitions([
    { key: 'ram_gb', label: 'RAM', dataType: 'number', required: true },
    {
      key: 'color',
      label: 'Color',
      dataType: 'select',
      variantAxis: true,
      options: ['Black', 'White'],
    },
  ]);

  it('normalizes product codes, SKUs, and money strings', () => {
    expect(normalizeCatalogCode(' p-1042 ')).toBe('P-1042');
    expect(normalizeMoneyAmount('12500')).toBe('12500.00');
    expect(normalizeMoneyAmount('12500.5')).toBe('12500.50');
  });

  it('separates product-level and variant-level values', () => {
    expect(validateProductLevelAttributes(definitions, { ram_gb: 8 })).toEqual({ ram_gb: 8 });
    expect(validateVariantAttributes(definitions, { color: 'Black' })).toEqual({
      color: 'Black',
    });
    expect(() => validateVariantAttributes(definitions, { ram_gb: 8 })).toThrow();
  });

  it('creates a stable variant-combination key', () => {
    expect(canonicalizeAttributes({ size: 'M', color: 'Black' })).toBe(
      canonicalizeAttributes({ color: 'Black', size: 'M' }),
    );
  });
});
