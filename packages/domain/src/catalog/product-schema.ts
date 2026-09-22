export const ATTRIBUTE_DATA_TYPES = [
  'text',
  'number',
  'boolean',
  'select',
  'multi_select',
] as const;

export type AttributeDataType = (typeof ATTRIBUTE_DATA_TYPES)[number];

export interface AttributeDefinitionInput {
  readonly key: string;
  readonly label: string;
  readonly dataType: AttributeDataType;
  readonly required?: boolean | undefined;
  readonly searchable?: boolean | undefined;
  readonly variantAxis?: boolean | undefined;
  readonly options?: readonly string[] | undefined;
}

export interface AttributeDefinition {
  readonly key: string;
  readonly label: string;
  readonly dataType: AttributeDataType;
  readonly required: boolean;
  readonly searchable: boolean;
  readonly variantAxis: boolean;
  readonly options: readonly string[];
  readonly position: number;
}

export interface CatalogSchemaIssue {
  readonly path: string;
  readonly message: string;
}

export class CatalogSchemaValidationError extends Error {
  constructor(readonly issues: readonly CatalogSchemaIssue[]) {
    super('The product type schema is invalid.');
    this.name = 'CatalogSchemaValidationError';
  }
}

const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const VARIANT_AXIS_TYPES = new Set<AttributeDataType>(['text', 'number', 'select']);

export function normalizeAttributeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function validateAttributeDefinitions(
  definitions: readonly AttributeDefinitionInput[],
): readonly AttributeDefinition[] {
  const issues: CatalogSchemaIssue[] = [];
  const seenKeys = new Set<string>();

  if (definitions.length > 50) {
    issues.push({ path: 'attributes', message: 'A product type supports at most 50 attributes.' });
  }

  const normalized = definitions.map((definition, position): AttributeDefinition => {
    const key = normalizeAttributeKey(definition.key);
    const label = definition.label.trim();
    const options = (definition.options ?? []).map((option) => option.trim());

    if (!ATTRIBUTE_KEY_PATTERN.test(key)) {
      issues.push({
        path: `attributes.${position}.key`,
        message: 'Use lowercase letters, numbers, and underscores; start with a letter.',
      });
    }
    if (seenKeys.has(key)) {
      issues.push({
        path: `attributes.${position}.key`,
        message: `Duplicate attribute key: ${key}.`,
      });
    }
    seenKeys.add(key);

    if (label.length < 1 || label.length > 80) {
      issues.push({
        path: `attributes.${position}.label`,
        message: 'Attribute labels must contain between 1 and 80 characters.',
      });
    }

    const needsOptions = definition.dataType === 'select' || definition.dataType === 'multi_select';
    if (needsOptions && options.length === 0) {
      issues.push({
        path: `attributes.${position}.options`,
        message: `${definition.dataType} attributes require at least one option.`,
      });
    }
    if (!needsOptions && options.length > 0) {
      issues.push({
        path: `attributes.${position}.options`,
        message: `${definition.dataType} attributes cannot define options.`,
      });
    }
    if (options.length > 100) {
      issues.push({
        path: `attributes.${position}.options`,
        message: 'An attribute supports at most 100 options.',
      });
    }
    const uniqueOptions = new Set(options.map((option) => option.toLocaleLowerCase()));
    if (
      uniqueOptions.size !== options.length ||
      options.some((option) => option.length < 1 || option.length > 80)
    ) {
      issues.push({
        path: `attributes.${position}.options`,
        message: 'Options must be unique, non-empty, and no longer than 80 characters.',
      });
    }

    if (definition.variantAxis && !VARIANT_AXIS_TYPES.has(definition.dataType)) {
      issues.push({
        path: `attributes.${position}.variantAxis`,
        message: 'Variant axes may use text, number, or select attributes only.',
      });
    }

    return {
      key,
      label,
      dataType: definition.dataType,
      required: definition.required ?? false,
      searchable: definition.searchable ?? false,
      variantAxis: definition.variantAxis ?? false,
      options,
      position,
    };
  });

  if (normalized.filter((definition) => definition.variantAxis).length > 3) {
    issues.push({ path: 'attributes', message: 'A product type supports at most 3 variant axes.' });
  }

  if (issues.length > 0) throw new CatalogSchemaValidationError(issues);
  return normalized;
}

export function validateCustomAttributes(
  definitions: readonly AttributeDefinition[],
  value: unknown,
  options: { readonly partial?: boolean } = {},
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CatalogSchemaValidationError([
      { path: 'customAttributes', message: 'Custom attributes must be an object.' },
    ]);
  }

  const input = value as Record<string, unknown>;
  const definitionByKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const issues: CatalogSchemaIssue[] = [];
  const normalized: Record<string, unknown> = {};

  for (const key of Object.keys(input)) {
    if (!definitionByKey.has(key)) {
      issues.push({ path: `customAttributes.${key}`, message: 'Unknown attribute.' });
    }
  }

  for (const definition of definitions) {
    const attributeValue = input[definition.key];
    const missing =
      attributeValue === undefined ||
      attributeValue === null ||
      attributeValue === '' ||
      (Array.isArray(attributeValue) && attributeValue.length === 0);

    if (missing) {
      if (definition.required && !options.partial) {
        issues.push({
          path: `customAttributes.${definition.key}`,
          message: 'This attribute is required.',
        });
      }
      continue;
    }

    const path = `customAttributes.${definition.key}`;
    switch (definition.dataType) {
      case 'text':
        if (typeof attributeValue !== 'string') issues.push({ path, message: 'Expected text.' });
        else normalized[definition.key] = attributeValue.trim();
        break;
      case 'number':
        if (typeof attributeValue !== 'number' || !Number.isFinite(attributeValue)) {
          issues.push({ path, message: 'Expected a finite number.' });
        } else normalized[definition.key] = attributeValue;
        break;
      case 'boolean':
        if (typeof attributeValue !== 'boolean')
          issues.push({ path, message: 'Expected true or false.' });
        else normalized[definition.key] = attributeValue;
        break;
      case 'select':
        if (typeof attributeValue !== 'string' || !definition.options.includes(attributeValue)) {
          issues.push({ path, message: 'Expected one configured option.' });
        } else normalized[definition.key] = attributeValue;
        break;
      case 'multi_select':
        if (
          !Array.isArray(attributeValue) ||
          attributeValue.some(
            (item) => typeof item !== 'string' || !definition.options.includes(item),
          ) ||
          new Set(attributeValue).size !== attributeValue.length
        ) {
          issues.push({ path, message: 'Expected unique configured options.' });
        } else normalized[definition.key] = attributeValue;
        break;
    }
  }

  if (issues.length > 0) throw new CatalogSchemaValidationError(issues);
  return normalized;
}
