import { parseTenantId, type TenantId } from '@ai-business/domain';

export interface TenantJobEnvelope<TPayload> {
  readonly tenantId: TenantId;
  readonly correlationId: string;
  readonly payload: TPayload;
}

export function createTenantJobEnvelope<TPayload>(input: {
  tenantId: string;
  correlationId: string;
  payload: TPayload;
}): TenantJobEnvelope<TPayload> {
  if (input.correlationId.trim().length === 0) {
    throw new Error('Correlation ID is required for every job.');
  }

  return {
    tenantId: parseTenantId(input.tenantId),
    correlationId: input.correlationId,
    payload: input.payload,
  };
}
