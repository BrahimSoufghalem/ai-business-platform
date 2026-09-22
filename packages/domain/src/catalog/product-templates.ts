import type { AttributeDefinitionInput } from './product-schema.js';

export type ProductTypeTemplateKey =
  'general' | 'clothing' | 'shoes' | 'smartphone' | 'laptop' | 'headset';

export interface ProductTypeTemplate {
  readonly key: ProductTypeTemplateKey;
  readonly name: string;
  readonly attributes: readonly AttributeDefinitionInput[];
}

export const PRODUCT_TYPE_TEMPLATES: readonly ProductTypeTemplate[] = [
  { key: 'general', name: 'General Product', attributes: [] },
  {
    key: 'clothing',
    name: 'Clothing',
    attributes: [
      {
        key: 'size',
        label: 'Size',
        dataType: 'select',
        required: true,
        variantAxis: true,
        options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
      },
      {
        key: 'color',
        label: 'Color',
        dataType: 'text',
        required: true,
        searchable: true,
        variantAxis: true,
      },
      { key: 'material', label: 'Material', dataType: 'text', searchable: true },
    ],
  },
  {
    key: 'shoes',
    name: 'Shoes',
    attributes: [
      {
        key: 'size',
        label: 'Size',
        dataType: 'number',
        required: true,
        searchable: true,
        variantAxis: true,
      },
      {
        key: 'color',
        label: 'Color',
        dataType: 'text',
        required: true,
        searchable: true,
        variantAxis: true,
      },
      { key: 'material', label: 'Material', dataType: 'text', searchable: true },
    ],
  },
  {
    key: 'smartphone',
    name: 'Smartphone',
    attributes: [
      {
        key: 'storage',
        label: 'Storage',
        dataType: 'select',
        required: true,
        searchable: true,
        variantAxis: true,
        options: ['64 GB', '128 GB', '256 GB', '512 GB', '1 TB'],
      },
      { key: 'ram_gb', label: 'RAM (GB)', dataType: 'number', required: true, searchable: true },
      {
        key: 'color',
        label: 'Color',
        dataType: 'text',
        required: true,
        searchable: true,
        variantAxis: true,
      },
      { key: 'warranty_months', label: 'Warranty (months)', dataType: 'number' },
    ],
  },
  {
    key: 'laptop',
    name: 'Laptop',
    attributes: [
      { key: 'ram_gb', label: 'RAM (GB)', dataType: 'number', required: true, searchable: true },
      {
        key: 'storage_gb',
        label: 'Storage (GB)',
        dataType: 'number',
        required: true,
        searchable: true,
      },
      { key: 'cpu', label: 'CPU', dataType: 'text', required: true, searchable: true },
      { key: 'color', label: 'Color', dataType: 'text', searchable: true, variantAxis: true },
      { key: 'warranty_months', label: 'Warranty (months)', dataType: 'number' },
    ],
  },
  {
    key: 'headset',
    name: 'Headset',
    attributes: [
      {
        key: 'connection',
        label: 'Connection',
        dataType: 'select',
        required: true,
        searchable: true,
        options: ['Wired', 'Bluetooth', 'USB'],
      },
      { key: 'microphone', label: 'Microphone', dataType: 'boolean', searchable: true },
      { key: 'color', label: 'Color', dataType: 'text', searchable: true, variantAxis: true },
    ],
  },
];

export function getProductTypeTemplate(key: string): ProductTypeTemplate | undefined {
  return PRODUCT_TYPE_TEMPLATES.find((template) => template.key === key);
}
