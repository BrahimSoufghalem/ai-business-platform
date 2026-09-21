import { sql } from 'drizzle-orm';
import type { TenantContext } from '@ai-business/domain';

/** Builds the transaction-local settings statement used by Drizzle callers. */
export function tenantSessionStatement(context: TenantContext) {
  if (context.actor.type !== 'user') {
    throw new Error('User tenant sessions require a verified user identity.');
  }

  return sql`select
    set_config('app.tenant_id', ${context.tenantId}, true),
    set_config('app.identity_subject', ${context.actor.id}, true),
    set_config('app.correlation_id', ${context.correlationId}, true)`;
}
