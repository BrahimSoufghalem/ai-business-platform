import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { createDatabaseClient } from '@ai-business/db';
import { InstagramSubscriptionError } from '@ai-business/integrations';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';
import { InstagramConnectionService } from '../src/integrations/instagram-connection.service.js';
import { InstagramWebhookService } from '../src/integrations/instagram-webhook.service.js';

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
  let webhooks: InstagramWebhookService;
  const subscribedAccounts: string[] = [];
  const previousEnvironment: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const name of ['INSTAGRAM_CREDENTIAL_ENCRYPTION_KEY', 'INSTAGRAM_APP_SECRET']) {
      previousEnvironment[name] = process.env[name];
    }
    process.env.INSTAGRAM_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.INSTAGRAM_APP_SECRET = 'instagram-integration-app-secret-123456';
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
    connections = new InstagramConnectionService(
      database,
      async ({ accountId }) => ({ accountId, username: 'test-account' }),
      async ({ accountId }) => {
        subscribedAccounts.push(accountId);
        return { accountId, subscribedFields: ['messages'] };
      },
    );
    webhooks = new InstagramWebhookService(database);
  });

  beforeEach(async () => {
    await admin`delete from message_processing_jobs where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from messages where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from conversation_transitions where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from conversations where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from customer_contacts where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from customers where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from instagram_accounts where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`
      delete from audit_events
      where tenant_id in (${tenantA}, ${tenantB})
        and entity_type = 'instagram_account'
    `;
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
    await admin`delete from memberships where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from app_users where id in (${ownerUserId}, ${agentUserId})`;
    await database.onApplicationShutdown();
    await admin.end();
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
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

  it('subscribes the connected account to messaging webhooks before storing it', async () => {
    await connections.connect(ownerIdentity, 'instagram-connect-subscribe', tenantA, {
      accountId: '17841400000000007',
      accessToken,
    });

    expect(subscribedAccounts).toContain('17841400000000007');
    const [audit] = await admin<{ metadata: Record<string, unknown> }[]>`
      select metadata
      from audit_events
      where tenant_id = ${tenantA} and action = 'instagram.connection.saved'
      order by created_at desc
      limit 1
    `;
    expect(audit?.metadata).toMatchObject({ subscribedFields: ['messages'] });
  });

  it('rejects a connection when Meta refuses the webhook subscription', async () => {
    const refusing = new InstagramConnectionService(
      database,
      async ({ accountId }) => ({ accountId, username: 'test-account' }),
      async () => {
        throw new InstagramSubscriptionError(401, 190, 'invalid_credentials');
      },
    );

    await expect(
      refusing.connect(ownerIdentity, 'instagram-connect-subscribe-refused', tenantA, {
        accountId: '17841400000000008',
        accessToken,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const [stored] = await admin<{ itemCount: number }[]>`
      select count(*)::int as "itemCount"
      from instagram_accounts
      where tenant_id = ${tenantA}
    `;
    expect(stored?.itemCount).toBe(0);
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

  it('resolves a signed webhook account internally and binds messages to its tenant', async () => {
    await connections.connect(ownerIdentity, 'instagram-connect-webhook', tenantA, {
      accountId: '17841400000000004',
      accessToken,
    });

    const payload = {
      object: 'instagram',
      entry: [
        {
          id: '17841400000000004',
          messaging: [
            {
              sender: { id: '99112233' },
              timestamp: 1_790_000_000_000,
              message: { mid: 'ig-webhook-mid-1', text: 'هل المنتج متوفر؟' },
            },
          ],
        },
      ],
    };

    await expect(webhooks.accept(payload, 'instagram-ingest-first')).resolves.toEqual({
      received: true,
      acceptedMessages: 1,
      replayedMessages: 0,
      queuedJobs: 1,
    });
    await expect(webhooks.accept(payload, 'instagram-ingest-replay')).resolves.toEqual({
      received: true,
      acceptedMessages: 0,
      replayedMessages: 1,
      queuedJobs: 0,
    });

    const [counts] = await admin<
      {
        customers: number;
        conversations: number;
        messages: number;
        jobs: number;
      }[]
    >`
      select
        (
          select count(*)::int from customer_contacts
          where tenant_id = ${tenantA} and normalized_value = 'igsid:99112233'
        ) as customers,
        (
          select count(*)::int from conversations
          where tenant_id = ${tenantA} and channel = 'instagram'
            and external_thread_id = '99112233'
        ) as conversations,
        (
          select count(*)::int from messages
          where tenant_id = ${tenantA} and external_id = 'ig-webhook-mid-1'
        ) as messages,
        (
          select count(*)::int from message_processing_jobs
          where tenant_id = ${tenantA}
        ) as jobs
    `;
    expect(counts).toEqual({ customers: 1, conversations: 1, messages: 1, jobs: 1 });
  });

  it('ingests messages delivered through entry changes and recipient account matching', async () => {
    await connections.connect(ownerIdentity, 'instagram-connect-changes', tenantA, {
      accountId: '17841400000000006',
      accessToken,
    });

    await expect(
      webhooks.accept(
        {
          object: 'instagram',
          entry: [
            {
              id: '0',
              time: 1_790_000_000,
              changes: [
                {
                  field: 'messages',
                  value: {
                    sender: { id: '66554433' },
                    recipient: { id: '17841400000000006' },
                    timestamp: '1790000000',
                    message: { mid: 'ig-change-mid-1', text: 'مرحبا' },
                  },
                },
              ],
            },
          ],
        },
        'instagram-ingest-changes',
      ),
    ).resolves.toEqual({
      received: true,
      acceptedMessages: 1,
      replayedMessages: 0,
      queuedJobs: 1,
    });

    const [counts] = await admin<
      {
        customers: number;
        messages: number;
        jobs: number;
      }[]
    >`
      select
        (
          select count(*)::int from customer_contacts
          where tenant_id = ${tenantA} and normalized_value = 'igsid:66554433'
        ) as customers,
        (
          select count(*)::int from messages
          where tenant_id = ${tenantA} and external_id = 'ig-change-mid-1'
        ) as messages,
        (
          select count(*)::int from message_processing_jobs
          where tenant_id = ${tenantA}
        ) as jobs
    `;
    expect(counts).toEqual({ customers: 1, messages: 1, jobs: 1 });
  });

  it('ignores signed events for an account that is not connected', async () => {
    await expect(
      webhooks.accept(
        {
          object: 'instagram',
          entry: [
            {
              id: '17841499999999999',
              messaging: [
                {
                  sender: { id: '44556677' },
                  timestamp: 1_790_000_000_000,
                  message: { mid: 'ig-unknown-account', text: 'hello' },
                },
              ],
            },
          ],
        },
        'instagram-unknown-account',
      ),
    ).resolves.toEqual({
      received: true,
      acceptedMessages: 0,
      replayedMessages: 0,
      queuedJobs: 0,
    });
  });

  it('rejects a reused external message ID with different content', async () => {
    await connections.connect(ownerIdentity, 'instagram-connect-conflict', tenantA, {
      accountId: '17841400000000005',
      accessToken,
    });
    const firstPayload = {
      object: 'instagram',
      entry: [
        {
          id: '17841400000000005',
          messaging: [
            {
              sender: { id: '99887766' },
              timestamp: 1_790_000_000_000,
              message: { mid: 'ig-conflicting-mid', text: 'first' },
            },
          ],
        },
      ],
    };
    await webhooks.accept(firstPayload, 'instagram-conflict-first');

    await expect(
      webhooks.accept(
        {
          ...firstPayload,
          entry: [
            {
              ...firstPayload.entry[0],
              messaging: [
                {
                  ...firstPayload.entry[0]!.messaging[0],
                  message: { mid: 'ig-conflicting-mid', text: 'changed' },
                },
              ],
            },
          ],
        },
        'instagram-conflict-second',
      ),
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
    ).resolves.toBeNull();
    const [stored] = await admin<{ itemCount: number }[]>`
      select count(*)::int as "itemCount"
      from instagram_accounts
      where tenant_id = ${tenantA}
    `;
    expect(stored?.itemCount).toBe(0);
  });
});
