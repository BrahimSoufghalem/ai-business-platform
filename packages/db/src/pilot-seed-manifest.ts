export interface PilotSeedProduct {
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly sku: string;
  readonly variantName: string | null;
  readonly price: number;
  readonly onHand: number;
  readonly reorderPoint: number;
}

export interface PilotSeedManifest {
  readonly tenantId: string;
  readonly identitySubject: string;
  readonly currency: string;
  readonly productType: {
    readonly name: string;
    readonly slug: string;
  };
  readonly location: {
    readonly code: string;
    readonly name: string;
    readonly isDefault: boolean;
  };
  readonly products: readonly PilotSeedProduct[];
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  path: string,
  allowedKeys: readonly string[],
): void {
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.includes(key));
  if (unknownKey) throw new Error(`${path}.${unknownKey} is not supported.`);
}

function text(
  value: unknown,
  path: string,
  options: { min?: number; max: number; pattern?: RegExp },
): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string.`);
  const normalized = value.trim();
  if (
    normalized.length < (options.min ?? 1) ||
    normalized.length > options.max ||
    (options.pattern && !options.pattern.test(normalized))
  ) {
    throw new Error(`${path} is invalid.`);
  }
  return normalized;
}

function nullableText(value: unknown, path: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return text(value, path, { max });
}

function number(
  value: unknown,
  path: string,
  options: { integer?: boolean; min: number; max: number },
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < options.min ||
    value > options.max ||
    (options.integer && !Number.isSafeInteger(value))
  ) {
    throw new Error(`${path} must be a valid number.`);
  }
  return value;
}

export function parsePilotSeedManifest(value: unknown): PilotSeedManifest {
  const root = object(value, 'manifest');
  exactKeys(root, 'manifest', [
    'tenantId',
    'identitySubject',
    'currency',
    'productType',
    'location',
    'products',
  ]);
  const productType = object(root.productType, 'productType');
  exactKeys(productType, 'productType', ['name', 'slug']);
  const location = object(root.location, 'location');
  exactKeys(location, 'location', ['code', 'name', 'isDefault']);
  if (!Array.isArray(root.products) || root.products.length < 1 || root.products.length > 25) {
    throw new Error('products must contain between 1 and 25 items.');
  }
  const products = root.products.map((candidate, index) => {
    const product = object(candidate, `products[${index}]`);
    exactKeys(product, `products[${index}]`, [
      'code',
      'name',
      'description',
      'sku',
      'variantName',
      'price',
      'onHand',
      'reorderPoint',
    ]);
    return {
      code: text(product.code, `products[${index}].code`, {
        max: 40,
        pattern: /^[A-Za-z0-9._-]+$/u,
      }),
      name: text(product.name, `products[${index}].name`, { max: 160 }),
      description: nullableText(product.description, `products[${index}].description`, 2_000),
      sku: text(product.sku, `products[${index}].sku`, {
        max: 80,
        pattern: /^[A-Za-z0-9._-]+$/u,
      }),
      variantName: nullableText(product.variantName, `products[${index}].variantName`, 120),
      price: number(product.price, `products[${index}].price`, {
        min: 0,
        max: 999_999_999_999,
      }),
      onHand: number(product.onHand, `products[${index}].onHand`, {
        integer: true,
        min: 0,
        max: 1_000_000,
      }),
      reorderPoint: number(product.reorderPoint, `products[${index}].reorderPoint`, {
        integer: true,
        min: 0,
        max: 1_000_000,
      }),
    };
  });
  if (new Set(products.map((product) => product.code)).size !== products.length) {
    throw new Error('Product codes must be unique in the manifest.');
  }
  if (new Set(products.map((product) => product.sku)).size !== products.length) {
    throw new Error('Product SKUs must be unique in the manifest.');
  }

  return {
    tenantId: text(root.tenantId, 'tenantId', {
      max: 36,
      pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    }),
    identitySubject: text(root.identitySubject, 'identitySubject', { max: 200 }),
    currency: text(root.currency, 'currency', {
      min: 3,
      max: 3,
      pattern: /^[A-Z]{3}$/u,
    }),
    productType: {
      name: text(productType.name, 'productType.name', { max: 120 }),
      slug: text(productType.slug, 'productType.slug', {
        max: 80,
        pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
      }),
    },
    location: {
      code: text(location.code, 'location.code', {
        max: 40,
        pattern: /^[A-Za-z0-9._-]+$/u,
      }),
      name: text(location.name, 'location.name', { max: 120 }),
      isDefault: location.isDefault === true,
    },
    products,
  };
}
