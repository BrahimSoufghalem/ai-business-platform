import { describe, expect, it } from 'vitest';
import {
  assertTenantScope,
  CrossTenantAccessError,
  parseTenantId,
  type TenantContext,
} from '../src/tenant-context.js';

const tenantA = parseTenantId('33fd872b-594c-812e-b42f-0002c063ad9c');
const tenantB = parseTenantId('43fd872b-594c-812e-b42f-0002c063ad9c');

const context: TenantContext = {
  tenantId: tenantA,
  actor: { type: 'user', id: 'user-1' },
  correlationId: 'request-1',
};

describe('tenant context', () => {
  it('normalizes a valid tenant UUID', () => {
    expect(parseTenantId('33FD872B-594C-812E-B42F-0002C063AD9C')).toBe(tenantA);
  });

  it('rejects malformed tenant IDs', () => {
    expect(() => parseTenantId('tenant-a')).toThrow('Tenant ID must be a valid UUID.');
  });

  it('allows access to the active tenant', () => {
    expect(() => assertTenantScope(context, tenantA)).not.toThrow();
  });

  it('denies cross-tenant access', () => {
    expect(() => assertTenantScope(context, tenantB)).toThrow(CrossTenantAccessError);
  });
});
