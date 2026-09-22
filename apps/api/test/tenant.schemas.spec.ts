import { describe, expect, it } from 'vitest';
import { createTenantSchema } from '../src/tenants/tenant.schemas.js';

describe('tenant input schema', () => {
  it('applies Algeria defaults', () => {
    expect(createTenantSchema.parse({ name: 'متجر التجربة' })).toEqual({
      name: 'متجر التجربة',
      locale: 'ar-DZ',
      timezone: 'Africa/Algiers',
    });
  });

  it('rejects an invalid timezone', () => {
    expect(() =>
      createTenantSchema.parse({ name: 'Pilot Store', timezone: 'Mars/Olympus' }),
    ).toThrow();
  });
});
