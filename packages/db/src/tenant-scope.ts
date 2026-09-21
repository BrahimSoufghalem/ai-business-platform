import { sql } from 'drizzle-orm';
import type { TenantId } from '@ai-business/domain';

/**
 * Execute this statement with SET LOCAL semantics inside the same transaction
 * as tenant-scoped queries. Never use a client-provided tenant ID.
 */
export function tenantScopeStatement(tenantId: TenantId) {
  return sql`select set_config('app.tenant_id', ${tenantId}, true)`;
}
