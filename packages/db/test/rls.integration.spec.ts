import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseTenantId, type TenantContext } from '@ai-business/domain';
import { createDatabaseClient, withTenantTransaction } from '../src/client.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const tenantA = parseTenantId('11111111-1111-4111-8111-111111111111');
const tenantB = parseTenantId('22222222-2222-4222-8222-222222222222');
const userA = 'identity-user-a';
const userB = 'identity-user-b';

function context(tenantId: string, identitySubject: string): TenantContext {
  return {
    tenantId: parseTenantId(tenantId),
    actor: { type: 'user', id: identitySubject },
    correlationId: `test-${identitySubject}-${tenantId}`,
  };
}

describeWithDatabase('PostgreSQL tenant RLS', () => {
  if (!databaseUrl) return;

  const admin = postgres(databaseUrl, { max: 1 });
  const runtimeUrl = new URL(databaseUrl);
  runtimeUrl.username = 'ai_business_runtime';
  runtimeUrl.password = 'runtime_test_only';
  const runtime = createDatabaseClient(runtimeUrl.toString());

  beforeAll(async () => {
    await admin.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_business_runtime') THEN
          CREATE ROLE ai_business_runtime LOGIN PASSWORD 'runtime_test_only'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
        ELSE
          ALTER ROLE ai_business_runtime LOGIN PASSWORD 'runtime_test_only'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
        END IF;
      END
      $$;

      GRANT USAGE ON SCHEMA public TO ai_business_runtime;
      GRANT SELECT, INSERT, UPDATE, DELETE
        ON tenants, memberships, audit_events
        TO ai_business_runtime;
      GRANT EXECUTE ON FUNCTION app_current_tenant_id() TO ai_business_runtime;
      GRANT EXECUTE ON FUNCTION app_current_identity_subject() TO ai_business_runtime;
      GRANT EXECUTE ON FUNCTION app_has_active_tenant_membership(uuid) TO ai_business_runtime;
    `);

    await admin`
      insert into tenants (id, name)
      values (${tenantA}, 'Tenant A'), (${tenantB}, 'Tenant B')
      on conflict (id) do update set name = excluded.name
    `;
    await admin`
      insert into app_users (id, identity_provider_id, email)
      values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ${userA}, 'a@example.test'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ${userB}, 'b@example.test')
      on conflict (identity_provider_id) do update set email = excluded.email
    `;
    await admin`
      insert into memberships (tenant_id, user_id, role, status)
      values
        (${tenantA}, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner', 'active'),
        (${tenantB}, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'owner', 'active')
      on conflict (tenant_id, user_id) do update set status = 'active'
    `;
  });

  afterAll(async () => {
    await runtime.end();
    await admin.end();
  });

  it('shows only the active tenant to an active member', async () => {
    const rows = await withTenantTransaction(
      runtime,
      context(tenantA, userA),
      (tx) => tx<{ id: string }[]>`select id::text from tenants order by id`,
    );

    expect(rows).toEqual([{ id: tenantA }]);
  });

  it('denies a valid identity that is not a member of the requested tenant', async () => {
    const rows = await withTenantTransaction(
      runtime,
      context(tenantB, userA),
      (tx) => tx<{ id: string }[]>`select id::text from tenants`,
    );

    expect(rows).toEqual([]);
  });

  it('isolates memberships by both tenant and identity', async () => {
    const rows = await withTenantTransaction(
      runtime,
      context(tenantA, userA),
      (tx) =>
        tx<{ tenantId: string }[]>`
        select tenant_id::text as "tenantId" from memberships order by tenant_id
      `,
    );

    expect(rows).toEqual([{ tenantId: tenantA }]);
  });

  it('rejects a cross-tenant audit write even when the candidate tenant is supplied', async () => {
    await expect(
      withTenantTransaction(
        runtime,
        context(tenantB, userA),
        (tx) =>
          tx`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action,
            entity_type, entity_id, correlation_id
          ) values (
            ${tenantB}, 'user', ${userA}, 'test.write',
            'tenant', ${tenantB}, 'rls-test'
          )
        `,
      ),
    ).rejects.toThrow();
  });
});
