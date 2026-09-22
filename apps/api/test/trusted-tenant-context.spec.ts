import { describe, expect, it } from 'vitest';
import { createCandidateTenantContext } from '../src/tenancy/trusted-tenant-context.js';

const identity = {
  subject: 'identity-user-1',
  issuer: 'https://identity.example.test/',
};

describe('createCandidateTenantContext', () => {
  it('uses only a verified identity as the actor', () => {
    const context = createCandidateTenantContext(
      identity,
      '33fd872b-594c-812e-b42f-0002c063ad9c',
      'request-123',
    );

    expect(context.actor.id).toBe('identity-user-1');
    expect(context.tenantId).toBe('33fd872b-594c-812e-b42f-0002c063ad9c');
  });

  it('rejects an invalid candidate tenant identifier', () => {
    expect(() => createCandidateTenantContext(identity, 'not-a-uuid', 'request-123')).toThrow(
      'Tenant ID must be a valid UUID.',
    );
  });
});
