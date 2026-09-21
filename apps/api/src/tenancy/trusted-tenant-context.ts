import { parseTenantId, type TenantContext } from '@ai-business/domain';

export interface AuthenticatedClaims {
  readonly subject: string;
  readonly tenantId: string;
  readonly correlationId: string;
}

/**
 * Creates a tenant context only from claims already verified by the auth layer.
 * Never call this with tenant IDs read from request bodies or arbitrary headers.
 */
export function createTenantContextFromTrustedClaims(claims: AuthenticatedClaims): TenantContext {
  if (claims.subject.trim().length === 0) {
    throw new Error('Authenticated subject is required.');
  }
  if (claims.correlationId.trim().length === 0) {
    throw new Error('Correlation ID is required.');
  }

  return {
    tenantId: parseTenantId(claims.tenantId),
    actor: {
      type: 'user',
      id: claims.subject,
    },
    correlationId: claims.correlationId,
  };
}
