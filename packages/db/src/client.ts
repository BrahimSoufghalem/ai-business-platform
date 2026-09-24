import postgres from 'postgres';
import type { TenantContext } from '@ai-business/domain';

export type DatabaseClient = postgres.Sql;
export type TenantTransaction = postgres.TransactionSql;

export interface IdentityTransactionContext {
  readonly identitySubject: string;
  readonly correlationId: string;
}

export function createDatabaseClient(databaseUrl: string): DatabaseClient {
  if (databaseUrl.trim().length === 0) {
    throw new Error('Database URL is required.');
  }

  return postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

export async function withIdentityTransaction<T>(
  client: DatabaseClient,
  context: IdentityTransactionContext,
  operation: (transaction: TenantTransaction) => Promise<T>,
): Promise<T> {
  if (context.identitySubject.trim().length === 0) {
    throw new Error('Verified identity subject is required.');
  }
  if (context.correlationId.trim().length === 0) {
    throw new Error('Correlation ID is required.');
  }

  const result = await client.begin(async (transaction) => {
    await transaction`
      select
        set_config('app.identity_subject', ${context.identitySubject}, true),
        set_config('app.correlation_id', ${context.correlationId}, true)
    `;

    return operation(transaction);
  });

  return result as T;
}

/**
 * Establishes the tenant, verified actor subject/type, and correlation ID using
 * transaction-local settings. PostgreSQL RLS verifies active membership for both
 * OIDC users and explicitly provisioned internal service principals.
 */
export async function withTenantTransaction<T>(
  client: DatabaseClient,
  context: TenantContext,
  operation: (transaction: TenantTransaction) => Promise<T>,
): Promise<T> {
  if (context.actor.id.trim().length === 0) {
    throw new Error('Tenant actor identity is required.');
  }

  const result = await client.begin(async (transaction) => {
    await transaction`
      select
        set_config('app.tenant_id', ${context.tenantId}, true),
        set_config('app.identity_subject', ${context.actor.id}, true),
        set_config('app.actor_type', ${context.actor.type}, true),
        set_config('app.correlation_id', ${context.correlationId}, true)
    `;

    return operation(transaction);
  });

  // postgres.js unwraps arrays of promises at the type level; an async callback
  // has already resolved the operation before the transaction is committed.
  return result as T;
}
