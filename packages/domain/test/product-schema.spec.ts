import { describe, expect, it } from 'vitest';
import {
  CatalogSchemaValidationError,
  validateAttributeDefinitions,
  validateCustomAttributes,
} from '../src/catalog/product-schema.js';
import { PRODUCT_TYPE_TEMPLATES } from '../src/catalog/product-templates.js';

describe('dynamic product schemas', () => {
  it('validates every built-in template', () => {
    for (const template of PRODUCT_TYPE_TEMPLATES) {
      expect(() => validateAttributeDefinitions(template.attributes)).not.toThrow();
    }
  });

  it('normalizes keys and applies safe defaults', () => {
    const [definition] = validateAttributeDefinitions([
      { key: 'Storage Size', label: 'Storage', dataType: 'number', required: true },
    ]);
    expect(definition).toEqual({
      key: 'storage_size',
      label: 'Storage',
      dataType: 'number',
      required: true,
      searchable: false,
      variantAxis: false,
      options: [],
      position: 0,
    });
  });

  it('rejects duplicate keys and invalid select options', () => {
    expect(() =>
      validateAttributeDefinitions([
        { key: 'color', label: 'Color', dataType: 'select', options: ['Black', 'black'] },
        { key: 'color', label: 'Second color', dataType: 'text' },
      ]),
    ).toThrow(CatalogSchemaValidationError);
  });

  it('validates product values against the configured schema', () => {
    const definitions = validateAttributeDefinitions([
      { key: 'size', label: 'Size', dataType: 'select', required: true, options: ['S', 'M'] },
      { key: 'in_stock', label: 'In stock', dataType: 'boolean' },
    ]);

    expect(validateCustomAttributes(definitions, { size: 'M', in_stock: true })).toEqual({
      size: 'M',
      in_stock: true,
    });
    expect(() => validateCustomAttributes(definitions, { size: 'XL' })).toThrow(
      CatalogSchemaValidationError,
    );
    expect(() => validateCustomAttributes(definitions, { unknown: 'value' })).toThrow(
      CatalogSchemaValidationError,
    );
  });
});
