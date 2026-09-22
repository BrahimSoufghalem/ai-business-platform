import { describe, expect, it } from 'vitest';
import { createCustomerSchema, updateCustomerSchema } from '../src/customers/customer.schemas.js';

describe('customer API schemas', () => {
  it('defaults metadata, addresses, and contact primary flags', () => {
    const parsed = createCustomerSchema.parse({
      name: 'Customer One',
      contacts: [{ type: 'phone', value: '0555 12 34 56' }],
    });
    expect(parsed.metadata).toEqual({});
    expect(parsed.addresses).toEqual([]);
    expect(parsed.contacts[0]?.isPrimary).toBe(false);
  });

  it('rejects duplicate primary contacts and empty updates', () => {
    expect(() =>
      createCustomerSchema.parse({
        name: 'Customer One',
        contacts: [
          { type: 'email', value: 'one@example.test', isPrimary: true },
          { type: 'email', value: 'two@example.test', isPrimary: true },
        ],
      }),
    ).toThrow();
    expect(() => updateCustomerSchema.parse({ expectedVersion: 1 })).toThrow();
  });
});
