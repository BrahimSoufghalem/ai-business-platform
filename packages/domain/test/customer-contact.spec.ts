import { describe, expect, it } from 'vitest';
import {
  CustomerContactValidationError,
  maskCustomerContact,
  normalizeCustomerContact,
} from '../src/index.js';

describe('customer contact normalization', () => {
  it('normalizes Algerian phone numbers, email, and Instagram handles', () => {
    expect(normalizeCustomerContact('phone', '0555 12 34 56')).toBe('+213555123456');
    expect(normalizeCustomerContact('whatsapp', '00213 555-12-34-56')).toBe('+213555123456');
    expect(normalizeCustomerContact('email', ' Sales@Example.COM ')).toBe('sales@example.com');
    expect(normalizeCustomerContact('instagram', '@Example.Shop')).toBe('example.shop');
  });

  it('rejects malformed contacts and masks values for presentation', () => {
    expect(() => normalizeCustomerContact('phone', '123')).toThrow(CustomerContactValidationError);
    expect(() => normalizeCustomerContact('email', 'not-an-email')).toThrow(
      CustomerContactValidationError,
    );
    expect(maskCustomerContact('phone', '+213555123456')).toBe('••••••3456');
    expect(maskCustomerContact('email', 'sales@example.com')).toBe('s•••@example.com');
  });
});
