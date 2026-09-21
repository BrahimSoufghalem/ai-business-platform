import type { VerifiedIdentity } from '@ai-business/auth';
import { parseTenantId, type TenantContext } from '@ai-business/domain';

/**
 * Builds a candidate tenant context from a cryptographically verified identity.
 * PostgreSQL RLS still verifies active membership for the candidate tenant.
 */
export function createCandidateTenantContext(
  identity: VerifiedIdentity,
  candidateTenantId: string,
  correlationId: string,
): TenantContext {
  if (correlationId.trim().length === 0) {
    throw new Error('Correlation ID is required.');
  }

  return {
    tenantId: parseTenantId(candidateTenantId),
    actor: { type: 'user', id: identity.subject },
    correlationId,
  };
}
