import {
  canonicalizeAttributes,
  normalizeCatalogCode,
  normalizeMoneyAmount,
  validateProductLevelAttributes,
  validateVariantAttributes,
  type AttributeDefinition,
  type ProductLifecycleStatus,
} from '@ai-business/domain';

export interface VariantInputLike {
  readonly sku: string;
  readonly name?: string | null | undefined;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly priceOverride?: string | null | undefined;
  readonly status: 'active' | 'archived';
}

export interface ValidatedVariant {
  readonly sku: string;
  readonly name: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly priceOverride: string | null;
  readonly status: 'active' | 'archived';
}

export interface ValidatedProductConfiguration {
  readonly code: string;
  readonly basePrice: string;
  readonly customAttributes: Readonly<Record<string, unknown>>;
  readonly variants: readonly ValidatedVariant[];
}

export function validateProductConfiguration(input: {
  readonly definitions: readonly AttributeDefinition[];
  readonly lifecycleStatus: ProductLifecycleStatus;
  readonly code: string;
  readonly basePrice: string;
  readonly customAttributes: Readonly<Record<string, unknown>>;
  readonly variants: readonly VariantInputLike[];
}): ValidatedProductConfiguration {
  const partial = input.lifecycleStatus === 'draft';
  if (!partial && input.variants.length === 0) {
    throw new Error('An active product requires at least one sellable variant.');
  }

  const customAttributes = validateProductLevelAttributes(
    input.definitions,
    input.customAttributes,
    { partial },
  );
  const skuSet = new Set<string>();
  const combinationSet = new Set<string>();
  const variants = input.variants.map((variant) => {
    const sku = normalizeCatalogCode(variant.sku, 'SKU');
    if (skuSet.has(sku)) throw new Error(`Duplicate SKU in request: ${sku}.`);
    skuSet.add(sku);

    const attributes = validateVariantAttributes(input.definitions, variant.attributes, {
      partial,
    });
    const combination = canonicalizeAttributes(attributes);
    if (combinationSet.has(combination)) {
      throw new Error('Variant attribute combinations must be unique.');
    }
    combinationSet.add(combination);

    return {
      sku,
      name: variant.name?.trim() || null,
      attributes,
      priceOverride:
        variant.priceOverride === null || variant.priceOverride === undefined
          ? null
          : normalizeMoneyAmount(variant.priceOverride),
      status: variant.status,
    } satisfies ValidatedVariant;
  });

  return {
    code: normalizeCatalogCode(input.code, 'Product code'),
    basePrice: normalizeMoneyAmount(input.basePrice),
    customAttributes,
    variants,
  };
}
