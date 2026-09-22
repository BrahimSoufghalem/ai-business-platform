export type ProductLifecycleStatus = 'draft' | 'active' | 'archived';

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,63}$/;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

export function normalizeCatalogCode(value: string, label = 'Code'): string {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, '-');
  if (!CODE_PATTERN.test(normalized)) {
    throw new Error(`${label} must use letters, numbers, underscores, or hyphens.`);
  }
  return normalized;
}

export function normalizeMoneyAmount(value: string): string {
  const normalized = value.trim();
  if (!MONEY_PATTERN.test(normalized)) {
    throw new Error('Money amounts must be positive decimal strings with at most 2 decimals.');
  }
  const [whole, fraction = ''] = normalized.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}
