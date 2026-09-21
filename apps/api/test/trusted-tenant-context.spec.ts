import { describe, expect, it } from 'vitest';
import { createTenantContextFromTrustedClaims } from '../src/tenancy/trusted-tenant-context.js';

describe('createTenantContextFromTrustedClaims', () => {
  it('creates context from verified claims', () => {
    const context = createTenantContextFromTrustedClaims({
      subject: 'user-123',
      tenantId: '33fd872b-594c-812e-b42f-0002c063ad9c',
      correlationId: 'request-123',
    });

    expect(context.actor.id).toBe('user-123');
    expect(context.tenantId).toBe('33fd872b-594c-812e-b42f-0002c063ad9c');
  });

  it('rejects an invalid tenant identifier', () => {
    expect(() =>
      createTenantContextFromTrustedClaims({
        subject: 'user-123',
        tenantId: 'not-a-uuid',
        correlationId: 'request-123',
      }),
    ).toThrow('Tenant ID must be a valid UUID.');
  });
});
