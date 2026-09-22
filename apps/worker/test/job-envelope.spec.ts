import { describe, expect, it } from 'vitest';
import { createTenantJobEnvelope } from '../src/job-envelope.js';

describe('createTenantJobEnvelope', () => {
  it('requires a valid tenant on every job', () => {
    expect(() =>
      createTenantJobEnvelope({
        tenantId: 'invalid',
        correlationId: 'job-1',
        payload: {},
      }),
    ).toThrow('Tenant ID must be a valid UUID.');
  });
});
