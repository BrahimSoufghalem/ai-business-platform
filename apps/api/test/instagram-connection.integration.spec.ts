import { randomBytes } from 'node:crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createDatabaseClient } from '@ai-business/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';
import { InstagramConnectionService } from '../src/integrations/instagram-connection.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const tenantA = '32323232-3232-4232-8232-323232323232';
const tenantB = '33333333-3333-4333-8333-333333333333';
const ownerUserId = '34343434-3434-4434-8434-343434343434';
const agentUserId = '35353535-3535-4535-8535-353535353535';
const ownerIdentity = {
  subject: 'instagram-connection-owner',
  issuer: 'https://identity.example.test',
} as const;
const agentIdentity = {
  subject: 'instagram-connection-agent',
  issuer: 'https://identity.example.test',
} as const;
const accessToken = 'IGQVJ-encrypted-integration-token-123456789';

describeWithDatabase('Instagram tenant connection', () => {
  if (!databaseUrl) return;

  const admin = createDatabaseClient(databaseUrl);
  let database: DatabaseService;
  let connections: InstagramConnectionService;
  let previousEncryptionKey: string | undefined;

  beforeAll(async () => {
    previousEncryptionKey = process.env.INSTAGRAM_CREDENTIAL_ENCRYPTION_KEY;
    process.env.INSTAGRAM_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.DATABASE_URL = databaseUrl;

    await admin`
      insert into tenants (id, name)
      values
        (${tenantA}, 'Instagram Tenant A'),
        (${tenantB}, 'Instagram Tenant B')
      on conflict (id) do update set name = excluded.name
    `;
    await admin`
      insert into app_users (id, identity_provider_id, email)
      values
        (${ownerUserId}, ${ownerIdentity.subject}, 'instagram-owner@example.test'),
        (${agentUserId}, ${agentIdentity.subject}, 'instagram-agent@example.test')
      on conflict (identity_provider_id) do update set email = excluded.email
    `;
    await admin`
      insert into memberships (tenant_id, user_id, role, status)
      values
        (${tenantA}, ${ownerUserId}, 'owner', 'active'),
        (${tenantB}, ${ownerUserId}, 'owner', 'active'),
        (${tenantA}, ${agentUserId}, 'agent', 'active')
      on conflict (tenant_id, user_id) do update
      set status = excluded.status, role = excluded.role
    `;

    database = new DatabaseService();
    connections = new InstagramConnectionService(database);
  });

  beforeEach(async () => {
    await admin`delete from instagram_accounts where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`
      delete from audit_events
      where tenant_id in (${tenantA}, ${tenantB})
        and entity_type = 'instagram_account'
    `;
  });

  afterAll(async () => {
    await admin`delete from instagram_accounts where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from audit_events where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from memberships where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from app_users where id in (${ownerUserId}, ${agentUserId})`;
    await database.onApplicationShutdown();
    await admin.end();
    if (previousEncryptionKey === undefined) {
      delete process.env.INSTAGRAM_CREDENTIAL_ENCRYPTION_KEY;
    } else {
      process.env.INSTAGRAM_CREDENTIAL_ENCRYPTION_KEY = previousEncryptionKey;
    }
  });

  it('stores the access token encrypted and never returns it', async () => {
    const view = await connections.connect(ownerIdentity, 'instagram-connect-a', tenantA, {
      accountId: '17841400000000000',
      accessToken,
    });
    const [stored] = await admin<
      {
        ciphertext: string;
        iv: string;
        authTag: string;
        metadata: Record<string, unknown>;
      }[]
    >`
      select
        account.access_token_ciphertext as ciphertext,
        account.access_token_iv as iv,
        account.access_token_auth_tag as "authTag",
        audit.metadata
      from instagram_accounts as account
      join audit_events as audit
        on audit.tenant_id = account.tenant_id
        and audit.entity_id = account.id::text
      where account.tenant_id = ${tenantA}
      limit 1
    `;

    expect(view).toMatchObject({
      accountId: '17841400000000000',
      accountIdSuffix: '0000',
      status: 'active',
    });
    expect(view).not.toHaveProperty('accessToken');
    expect(stored?.ciphertext).not.toContain(accessToken);
    expect(JSON.stringify(stored?.metadata)).not.toContain(accessToken);
    expect(stored?.iv).toBeTruthy();
    expect(stored?.authTag).toBeTruthy();
    await expect(connections.get(ownerIdentity, 'instagram-get-a', tenantA)).resolves.toEqual(view);
  });

  it('allows one tenant per Instagram account', async () => {
    await connections.connect(ownerIdentity, 'instagram-connect-unique-a', tenantA, {
      accountId: '17841400000000001',
      accessToken,
    });

    await expect(
      connections.connect(ownerIdentity, 'instagram-connect-unique-b', tenantB, {
        accountId: '17841400000000001',
        accessToken: `${accessToken}-other`,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows only the tenant owner to manage the connection', async () => {
    await expect(
      connections.connect(agentIdentity, 'instagram-connect-agent', tenantA, {
        accountId: '17841400000000002',
        accessToken,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('disconnects by deleting the encrypted credential', async () => {
    await connections.connect(ownerIdentity, 'instagram-connect-delete', tenantA, {
      accountId: '17841400000000003',
      accessToken,
    });
    await connections.disconnect(ownerIdentity, 'instagram-disconnect', tenantA);

    await expect(
      connections.get(ownerIdentity, 'instagram-get-deleted', tenantA),
    ).rejects.toBeInstanceOf(NotFoundException);
    const [stored] = await admin<{ itemCount: number }[]>`
      select count(*)::int as "itemCount"
      from instagram_accounts
      where tenant_id = ${tenantA}
    `;
    expect(stored?.itemCount).toBe(0);
  });
});
