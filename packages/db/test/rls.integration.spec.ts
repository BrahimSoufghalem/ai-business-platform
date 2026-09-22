import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseTenantId, type TenantContext } from '@ai-business/domain';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const tenantA = parseTenantId('11111111-1111-4111-8111-111111111111');
const tenantB = parseTenantId('22222222-2222-4222-8222-222222222222');
const userA = 'identity-user-a';
const userB = 'identity-user-b';
const provisioningUser = 'identity-user-provisioning-test';

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
  let provisionedTenantId: string | undefined;

  async function withRuntimeIdentity<T>(
    identitySubject: string,
    operation: (transaction: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> {
    const result = await admin.begin(async (transaction) => {
      await transaction.unsafe('set local role ai_business_runtime');
      await transaction`
        select
          set_config('app.identity_subject', ${identitySubject}, true),
          set_config('app.correlation_id', 'tenant-provisioning-test', true)
      `;
      return operation(transaction);
    });

    return result as T;
  }

  async function withRuntimeTenant<T>(
    tenantContext: TenantContext,
    operation: (transaction: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> {
    const result = await admin.begin(async (transaction) => {
      // SET ROLE verifies policies as the restricted production role while the
      // test keeps one CI database connection and avoids host-auth differences.
      await transaction.unsafe('set local role ai_business_runtime');
      await transaction`
        select
          set_config('app.tenant_id', ${tenantContext.tenantId}, true),
          set_config('app.identity_subject', ${tenantContext.actor.id}, true),
          set_config('app.correlation_id', ${tenantContext.correlationId}, true)
      `;

      return operation(transaction);
    });

    return result as T;
  }

  beforeAll(async () => {
    await admin.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_business_runtime') THEN
          CREATE ROLE ai_business_runtime
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS;
        ELSE
          ALTER ROLE ai_business_runtime
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS;
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
      GRANT EXECUTE ON FUNCTION app_list_current_identity_memberships()
        TO ai_business_runtime;
      GRANT EXECUTE ON FUNCTION app_current_membership_role(uuid)
        TO ai_business_runtime;
      GRANT EXECUTE ON FUNCTION app_provision_tenant(text, text, text, text)
        TO ai_business_runtime;
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
    if (provisionedTenantId) {
      await admin`delete from audit_events where tenant_id = ${provisionedTenantId}`;
      await admin`delete from tenants where id = ${provisionedTenantId}`;
    }
    await admin`
      delete from app_users
      where identity_provider_id = ${provisioningUser}
        and not exists (
          select 1 from memberships where user_id = app_users.id
        )
    `;
    await admin.end();
  });

  it('provisions a tenant, owner membership, and audit event atomically', async () => {
    const [created] = await withRuntimeIdentity(
      provisioningUser,
      (tx) =>
        tx<{ id: string }[]>`
          select app_provision_tenant(
            'Provisioned Pilot',
            'pilot@example.test',
            'ar-DZ',
            'Africa/Algiers'
          )::text as id
        `,
    );
    if (!created) throw new Error('Provisioning did not return a tenant ID.');
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    provisionedTenantId = created.id;

    const memberships = await withRuntimeIdentity(
      provisioningUser,
      (tx) =>
        tx<{ tenantId: string; role: string }[]>`
          select tenant_id::text as "tenantId", membership_role as role
          from app_list_current_identity_memberships()
        `,
    );
    expect(memberships).toContainEqual({
      tenantId: created.id,
      role: 'owner',
    });

    const [audit] = await admin<{ action: string; actorId: string }[]>`
      select action, actor_id as "actorId"
      from audit_events
      where tenant_id = ${created.id}
        and action = 'tenant.provisioned'
    `;
    expect(audit).toEqual({
      action: 'tenant.provisioned',
      actorId: provisioningUser,
    });
  });

  it('shows only the active tenant to an active member', async () => {
    const rows = await withRuntimeTenant(
      context(tenantA, userA),
      (tx) => tx<{ id: string }[]>`select id::text from tenants order by id`,
    );

    expect(rows).toEqual([{ id: tenantA }]);
  });

  it('denies a valid identity that is not a member of the requested tenant', async () => {
    const rows = await withRuntimeTenant(
      context(tenantB, userA),
      (tx) => tx<{ id: string }[]>`select id::text from tenants`,
    );

    expect(rows).toEqual([]);
  });

  it('isolates memberships by both tenant and identity', async () => {
    const rows = await withRuntimeTenant(
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
      withRuntimeTenant(
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
