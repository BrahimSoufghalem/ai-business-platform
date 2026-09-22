declare const tenantIdBrand: unique symbol;

export type TenantId = string & { readonly [tenantIdBrand]: true };

export interface TenantActor {
  readonly type: 'user' | 'service';
  readonly id: string;
}

export interface TenantContext {
  readonly tenantId: TenantId;
  readonly actor: TenantActor;
  readonly correlationId: string;
}

export class CrossTenantAccessError extends Error {
  constructor() {
    super('Cross-tenant access denied.');
    this.name = 'CrossTenantAccessError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseTenantId(value: string): TenantId {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error('Tenant ID must be a valid UUID.');
  }
  return normalized as TenantId;
}

export function assertTenantScope(context: TenantContext, resourceTenantId: TenantId): void {
  if (context.tenantId !== resourceTenantId) {
    throw new CrossTenantAccessError();
  }
}
