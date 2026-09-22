export type CustomerContactType = 'phone' | 'email' | 'whatsapp' | 'instagram';

export class CustomerContactValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomerContactValidationError';
  }
}

function normalizePhone(value: string, countryCode: string): string {
  let normalized = value.trim().replace(/[\s().-]/g, '');
  if (normalized.startsWith('00')) normalized = `+${normalized.slice(2)}`;
  if (!normalized.startsWith('+')) {
    if (countryCode === 'DZ' && normalized.startsWith('0')) {
      normalized = `+213${normalized.slice(1)}`;
    } else if (countryCode === 'DZ' && normalized.startsWith('213')) {
      normalized = `+${normalized}`;
    } else {
      normalized = `+${normalized}`;
    }
  }
  if (!/^\+[1-9][0-9]{6,14}$/.test(normalized)) {
    throw new CustomerContactValidationError('Phone contacts must be valid E.164 numbers.');
  }
  return normalized;
}

export function normalizeCustomerContact(
  type: CustomerContactType,
  value: string,
  defaultCountryCode = 'DZ',
): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CustomerContactValidationError('Contact value cannot be empty.');
  }
  if (type === 'phone' || type === 'whatsapp') {
    return normalizePhone(trimmed, defaultCountryCode.trim().toUpperCase());
  }
  if (type === 'email') {
    const normalized = trimmed.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) {
      throw new CustomerContactValidationError('Email contact is invalid.');
    }
    return normalized;
  }

  const normalized = trimmed.replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(normalized)) {
    throw new CustomerContactValidationError('Instagram contact is invalid.');
  }
  return normalized;
}

export function maskCustomerContact(type: CustomerContactType, normalizedValue: string): string {
  if (type === 'email') {
    const separator = normalizedValue.indexOf('@');
    if (separator <= 0) return '•••';
    const local = normalizedValue.slice(0, separator);
    const domain = normalizedValue.slice(separator + 1);
    return `${local.slice(0, 1)}•••@${domain}`;
  }
  if (type === 'phone' || type === 'whatsapp') {
    const visible = normalizedValue.slice(-4);
    return `••••••${visible}`;
  }
  if (normalizedValue.length <= 2) return `${normalizedValue.slice(0, 1)}•`;
  return `${normalizedValue.slice(0, 2)}•••`;
}
