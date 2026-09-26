import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const tenantA = '41414141-4141-4141-8141-414141414141';
const tenantB = '42424242-4242-4242-8242-424242424242';
const accountA = '17841400000001001';
const professionalA = '17841400000001002';
const accountB = '17841400000001003';
const professionalB = '17841400000001004';

describeWithDatabase('Instagram webhook identity resolution', () => {
  if (!databaseUrl) return;

  const admin = postgres(databaseUrl, { max: 5 });

  async function connectAccount(
    tenantId: string,
    accountId: string,
    professionalAccountId: string | null,
    status = 'active',
  ): Promise<void> {
    await admin`
      insert into instagram_accounts (
        tenant_id, instagram_account_id, instagram_professional_account_id,
        access_token_ciphertext, access_token_iv, access_token_auth_tag,
        token_fingerprint, status
      ) values (
        ${tenantId}, ${accountId}, ${professionalAccountId},
        'ciphertext-not-a-real-token', 'iv-value', 'auth-tag',
        ${'a'.repeat(16)}, ${status}::instagram_connection_status
      )
    `;
  }

  async function resolve(accountId: string): Promise<string | null> {
    const [row] = await admin<{ tenantId: string | null }[]>`
      select app_resolve_instagram_tenant(${accountId})::text as "tenantId"
    `;
    return row?.tenantId ?? null;
  }

  beforeAll(async () => {
    await admin`
      insert into tenants (id, name)
      values
        (${tenantA}, 'Webhook Identity A'),
        (${tenantB}, 'Webhook Identity B')
      on conflict (id) do update set name = excluded.name
    `;
  });

  beforeEach(async () => {
    await admin`delete from message_processing_jobs where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from messages where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from conversation_transitions where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from conversations where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from customer_contacts where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from customers where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from instagram_accounts where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from audit_events where tenant_id in (${tenantA}, ${tenantB})`;
  });

  afterAll(async () => {
    await admin`delete from message_processing_jobs where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from messages where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from conversation_transitions where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from conversations where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from customer_contacts where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from customers where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from instagram_accounts where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from audit_events where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin.end();
  });

  it('resolves an active integration by its Instagram professional account ID', async () => {
    await connectAccount(tenantA, accountA, professionalA);
    await expect(resolve(professionalA)).resolves.toBe(tenantA);
  });

  it('still resolves an active integration by its app-scoped account ID', async () => {
    await connectAccount(tenantA, accountA, professionalA);
    await expect(resolve(accountA)).resolves.toBe(tenantA);
  });

  it('does not resolve an inactive integration', async () => {
    await connectAccount(tenantA, accountA, professionalA, 'reauthorization_required');
    await expect(resolve(professionalA)).resolves.toBeNull();
    await expect(resolve(accountA)).resolves.toBeNull();
  });

  it('does not resolve unknown account IDs', async () => {
    await expect(resolve('17841400000009999')).resolves.toBeNull();
  });

  it('maps each account ID to its own tenant only', async () => {
    await connectAccount(tenantA, accountA, professionalA);
    await connectAccount(tenantB, accountB, professionalB);

    await expect(resolve(professionalA)).resolves.toBe(tenantA);
    await expect(resolve(accountA)).resolves.toBe(tenantA);
    await expect(resolve(professionalB)).resolves.toBe(tenantB);
    await expect(resolve(accountB)).resolves.toBe(tenantB);
  });

  it('rejects a professional account ID that is not numeric', async () => {
    await expect(connectAccount(tenantA, accountA, 'not-a-number')).rejects.toThrow();
  });

  it('allows only one tenant to claim a professional account ID', async () => {
    await connectAccount(tenantA, accountA, professionalA);
    await expect(connectAccount(tenantB, accountB, professionalA)).rejects.toThrow();
  });

  it('ingests a message that identifies the account by its professional account ID', async () => {
    await connectAccount(tenantA, accountA, professionalA);
    const [ingested] = await admin<{ tenantId: string; replayed: boolean; jobEnqueued: boolean }[]>`
      select
        tenant_id::text as "tenantId",
        replayed,
        job_enqueued as "jobEnqueued"
      from app_ingest_instagram_message(
        ${professionalA}, 'ig-identity-mid-1', '77001122', '77001122',
        now(), 'مرحبا', '{"channel":"instagram"}'::jsonb, ${'b'.repeat(64)},
        'identity-correlation-1'
      )
    `;
    expect(ingested).toMatchObject({ tenantId: tenantA, replayed: false, jobEnqueued: true });

    const [replayed] = await admin<{ replayed: boolean; jobEnqueued: boolean }[]>`
      select replayed, job_enqueued as "jobEnqueued"
      from app_ingest_instagram_message(
        ${professionalA}, 'ig-identity-mid-1', '77001122', '77001122',
        now(), 'مرحبا', '{"channel":"instagram"}'::jsonb, ${'b'.repeat(64)},
        'identity-correlation-2'
      )
    `;
    expect(replayed).toMatchObject({ replayed: true, jobEnqueued: false });

    const [counts] = await admin<{ tenantAMessages: number; tenantBMessages: number }[]>`
      select
        (
          select count(*)::int from messages
          where tenant_id = ${tenantA} and external_id = 'ig-identity-mid-1'
        ) as "tenantAMessages",
        (
          select count(*)::int from messages
          where tenant_id = ${tenantB} and external_id = 'ig-identity-mid-1'
        ) as "tenantBMessages"
    `;
    expect(counts).toEqual({ tenantAMessages: 1, tenantBMessages: 0 });
  });

  it('does not ingest for an inactive integration', async () => {
    await connectAccount(tenantA, accountA, professionalA, 'disabled');
    const rows = await admin`
      select * from app_ingest_instagram_message(
        ${professionalA}, 'ig-identity-mid-2', '77001123', '77001123',
        now(), 'hello', '{"channel":"instagram"}'::jsonb, ${'c'.repeat(64)},
        'identity-correlation-3'
      )
    `;
    expect(rows).toHaveLength(0);
  });
});
