import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createDatabaseClient } from '@ai-business/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationService } from '../src/conversations/conversation.service.js';
import { AgentSettingsService } from '../src/configuration/agent-settings.service.js';
import { BusinessRuleService } from '../src/configuration/business-rule.service.js';
import { KnowledgeService } from '../src/configuration/knowledge.service.js';
import { CustomerAgentService } from '../src/customer-agent/customer-agent.service.js';
import { CustomerService } from '../src/customers/customer.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { OrderService } from '../src/orders/order.service.js';
import { ProductService } from '../src/products/product.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const tenantA = '12121212-1212-4121-8121-121212121212';
const tenantB = '23232323-2323-4232-8232-232323232323';
const userId = '34343434-3434-4343-8343-343434343434';
const identity = {
  subject: 'api-customer-conversation-user',
  issuer: 'https://identity.example.test',
} as const;

describeWithDatabase('customer and conversation services', () => {
  if (!databaseUrl) return;

  const admin = createDatabaseClient(databaseUrl);
  let database: DatabaseService;
  let customers: CustomerService;
  let conversations: ConversationService;
  let customerAgent: CustomerAgentService;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    await admin`
      insert into tenants (id, name)
      values
        (${tenantA}, 'API Integration A'),
        (${tenantB}, 'API Integration B')
      on conflict (id) do update set name = excluded.name
    `;
    await admin`
      insert into app_users (id, identity_provider_id, email)
      values (${userId}, ${identity.subject}, 'integration@example.test')
      on conflict (identity_provider_id) do update set email = excluded.email
    `;
    await admin`
      insert into memberships (tenant_id, user_id, role, status)
      values
        (${tenantA}, ${userId}, 'owner', 'active'),
        (${tenantB}, ${userId}, 'owner', 'active')
      on conflict (tenant_id, user_id) do update set status = 'active', role = 'owner'
    `;
    database = new DatabaseService();
    customers = new CustomerService(database);
    conversations = new ConversationService(database);
    customerAgent = new CustomerAgentService(
      database,
      conversations,
      new ProductService(database),
      new InventoryService(database),
      new OrderService(database),
      new BusinessRuleService(database),
      new KnowledgeService(database),
      new AgentSettingsService(database),
    );
  });

  afterAll(async () => {
    await admin`delete from handoffs where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from ai_tool_calls where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from ai_runs where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from conversation_transitions where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from messages where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from conversations where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from customer_notes where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from customer_addresses where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from customer_contacts where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from customers where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from audit_events where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from memberships where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from app_users where id = ${userId}`;
    await database.onApplicationShutdown();
    await admin.end();
  });

  it('deduplicates normalized contacts and masks them in read models', async () => {
    const created = await customers.create(identity, 'customer-create-1', tenantA, {
      name: 'Customer Integration',
      contacts: [
        {
          type: 'phone',
          value: '0555 12 34 56',
          isPrimary: true,
        },
      ],
      addresses: [],
      metadata: {},
    });
    const replay = await customers.create(identity, 'customer-create-2', tenantA, {
      name: 'Duplicate Customer',
      contacts: [
        {
          type: 'whatsapp',
          value: '+213 555 12 34 56',
          isPrimary: true,
        },
      ],
      addresses: [],
      metadata: {},
    });

    expect(created.deduplicated).toBe(false);
    expect(replay.deduplicated).toBe(true);
    expect(replay.customer.id).toBe(created.customer.id);
    expect(replay.customer.contacts).toEqual([
      expect.objectContaining({ maskedValue: '••••••3456' }),
    ]);
    expect(JSON.stringify(replay.customer)).not.toContain('+213555123456');
  });

  it('replays external messages once and supports claim, close, and tenant isolation', async () => {
    const [customer] = await customers.list(identity, 'customer-list', tenantA, {
      status: 'active',
      q: 'Customer Integration',
      limit: 50,
    });
    if (!customer) throw new Error('Customer fixture not found.');
    const input = {
      customerId: customer.id,
      channel: 'internal' as const,
      externalThreadId: 'thread-service-integration',
      status: 'needs_human' as const,
      subject: 'Integration conversation',
      productId: null,
      draftOrderId: null,
      orderId: null,
      initialMessage: {
        direction: 'inbound' as const,
        senderType: 'customer' as const,
        senderId: null,
        externalId: 'external-initial-message',
        content: 'Is anyone available?',
        metadata: {},
      },
    };
    const created = await conversations.create(identity, 'conversation-create-1', tenantA, input);
    const replayedThread = await conversations.create(
      identity,
      'conversation-create-2',
      tenantA,
      input,
    );
    expect(replayedThread.id).toBe(created.id);
    expect(replayedThread.messages).toHaveLength(1);

    const claimed = await conversations.claim(identity, 'conversation-claim', tenantA, created.id, {
      expectedVersion: created.version,
    });
    expect(claimed.status).toBe('human');
    expect(claimed.assignedToMe).toBe(true);

    const message = {
      direction: 'outbound' as const,
      senderType: 'agent' as const,
      senderId: null,
      externalId: 'external-agent-message',
      content: 'Yes, I can help.',
      metadata: {},
    };
    const first = await conversations.appendMessage(
      identity,
      'message-create-1',
      tenantA,
      created.id,
      message,
    );
    const replay = await conversations.appendMessage(
      identity,
      'message-create-2',
      tenantA,
      created.id,
      message,
    );
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.id).toBe(first.id);

    const closed = await conversations.transition(
      identity,
      'conversation-close',
      tenantA,
      created.id,
      {
        expectedVersion: claimed.version,
        targetStatus: 'closed',
        reason: 'Resolved in integration test',
      },
    );
    expect(closed.status).toBe('closed');

    await expect(
      conversations.get(identity, 'cross-tenant-read', tenantB, created.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates one redacted handoff, stops the bot, and supports claim/release/resume', async () => {
    const [customer] = await customers.list(identity, 'handoff-customer-list', tenantA, {
      status: 'active',
      q: 'Customer Integration',
      limit: 50,
    });
    if (!customer) throw new Error('Customer fixture not found.');
    const conversation = await conversations.create(
      identity,
      'handoff-conversation-create',
      tenantA,
      {
        customerId: customer.id,
        channel: 'internal',
        externalThreadId: 'agent-handoff-thread',
        status: 'bot',
        subject: 'Human handoff integration',
        productId: null,
        draftOrderId: null,
        orderId: null,
        initialMessage: {
          direction: 'inbound',
          senderType: 'customer',
          senderId: null,
          externalId: 'handoff-customer-request',
          content: 'أريد التحدث مع موظف',
          metadata: {},
        },
      },
    );
    const inbound = conversation.messages[0];
    if (!inbound) throw new Error('Handoff inbound fixture was not created.');

    const handoffReply = await customerAgent.reply(
      identity,
      'handoff-agent-reply',
      tenantA,
      conversation.id,
      { messageId: inbound.id },
    );
    const replay = await customerAgent.reply(
      identity,
      'handoff-agent-replay',
      tenantA,
      conversation.id,
      { messageId: inbound.id },
    );
    expect(handoffReply.status).toBe('handoff');
    expect(handoffReply.handoffId).not.toBeNull();
    expect(replay).toEqual({ ...handoffReply, replayed: true });

    const queued = await conversations.get(
      identity,
      'handoff-queued-read',
      tenantA,
      conversation.id,
    );
    expect(queued.status).toBe('needs_human');
    expect(queued.assignedToUserId).toBeNull();
    expect(queued.handoffs).toHaveLength(1);
    expect(queued.activeHandoff).toMatchObject({
      id: handoffReply.handoffId,
      reason: 'explicit_customer_request',
      status: 'pending',
      intent: 'handoff',
      summary: {
        schemaVersion: 1,
        customerRequest: 'أريد التحدث مع موظف',
        collectedData: {
          hasCustomerPhone: false,
          hasShippingAddress: false,
          itemCount: 0,
        },
      },
    });
    expect(JSON.stringify(queued.activeHandoff?.summary)).not.toContain('0555123456');
    expect(
      queued.messages.filter((message) => message.metadata.kind === 'handoff_notification'),
    ).toHaveLength(1);

    const queuedMetrics = await conversations.getHandoffMetrics(
      identity,
      'handoff-metrics-queued',
      tenantA,
    );
    expect(queuedMetrics.pending).toBeGreaterThanOrEqual(1);

    const claimed = await conversations.claim(identity, 'handoff-claim', tenantA, conversation.id, {
      expectedVersion: queued.version,
    });
    expect(claimed.status).toBe('human');
    expect(claimed.assignedToMe).toBe(true);
    expect(claimed.activeHandoff).toMatchObject({
      id: handoffReply.handoffId,
      status: 'active',
      assignedToMe: true,
    });
    expect(claimed.activeHandoff?.firstClaimedAt).not.toBeNull();

    const newInbound = await conversations.appendMessage(
      identity,
      'handoff-new-inbound',
      tenantA,
      conversation.id,
      {
        direction: 'inbound',
        senderType: 'customer',
        senderId: null,
        externalId: 'handoff-customer-follow-up',
        content: 'هل أنت هنا؟',
        metadata: {},
      },
    );
    await expect(
      customerAgent.reply(identity, 'handoff-block-bot', tenantA, conversation.id, {
        messageId: newInbound.id,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      conversations.appendMessage(identity, 'handoff-block-system', tenantA, conversation.id, {
        direction: 'outbound',
        senderType: 'system',
        senderId: null,
        externalId: 'handoff-system-bypass',
        content: 'This must not bypass human ownership.',
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      conversations.appendMessage(identity, 'handoff-human-reply', tenantA, conversation.id, {
        direction: 'outbound',
        senderType: 'agent',
        senderId: null,
        externalId: 'handoff-agent-human-reply',
        content: 'نعم، أنا هنا للمساعدة.',
        metadata: {},
      }),
    ).resolves.toMatchObject({ replayed: false });

    const released = await conversations.release(
      identity,
      'handoff-release',
      tenantA,
      conversation.id,
      {
        expectedVersion: claimed.version,
        reason: 'Shift ended',
      },
    );
    expect(released.status).toBe('needs_human');
    expect(released.assignedToUserId).toBeNull();
    expect(released.activeHandoff).toMatchObject({
      id: handoffReply.handoffId,
      status: 'pending',
    });
    await expect(
      conversations.appendMessage(identity, 'handoff-unowned-reply', tenantA, conversation.id, {
        direction: 'outbound',
        senderType: 'agent',
        senderId: null,
        externalId: 'handoff-unowned-agent-reply',
        content: 'This must not be sent.',
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const reclaimed = await conversations.claim(
      identity,
      'handoff-reclaim',
      tenantA,
      conversation.id,
      { expectedVersion: released.version },
    );
    const resumed = await conversations.transition(
      identity,
      'handoff-resume-bot',
      tenantA,
      conversation.id,
      {
        expectedVersion: reclaimed.version,
        targetStatus: 'bot',
        reason: 'Safe automation can continue',
      },
    );
    expect(resumed.status).toBe('bot');
    expect(resumed.activeHandoff).toBeNull();
    expect(resumed.handoffs[0]).toMatchObject({
      id: handoffReply.handoffId,
      status: 'resolved',
      resolution: 'returned_to_bot',
    });
    expect(resumed.handoffs[0]?.resolutionSeconds).not.toBeNull();

    const resolvedMetrics = await conversations.getHandoffMetrics(
      identity,
      'handoff-metrics-resolved',
      tenantA,
    );
    expect(resolvedMetrics.resolved).toBeGreaterThanOrEqual(1);
    expect(resolvedMetrics.averageFirstResponseSeconds).not.toBeNull();
    expect(resolvedMetrics.averageResolutionSeconds).not.toBeNull();
  });

  it('persists a grounded static agent run and replays the same customer turn once', async () => {
    const [customer] = await customers.list(identity, 'agent-customer-list', tenantA, {
      status: 'active',
      q: 'Customer Integration',
      limit: 50,
    });
    if (!customer) throw new Error('Customer fixture not found.');
    const conversation = await conversations.create(identity, 'agent-conversation', tenantA, {
      customerId: customer.id,
      channel: 'internal',
      externalThreadId: 'agent-static-thread',
      status: 'bot',
      subject: 'Agent integration',
      productId: null,
      draftOrderId: null,
      orderId: null,
      initialMessage: {
        direction: 'inbound',
        senderType: 'customer',
        senderId: null,
        externalId: 'agent-greeting-inbound',
        content: 'السلام عليكم',
        metadata: {},
      },
    });
    const inbound = conversation.messages[0];
    if (!inbound) throw new Error('Inbound fixture message not found.');

    const reply = await customerAgent.reply(
      identity,
      'agent-reply-correlation',
      tenantA,
      conversation.id,
      { messageId: inbound.id },
    );
    const replay = await customerAgent.reply(
      identity,
      'agent-reply-replay-correlation',
      tenantA,
      conversation.id,
      { messageId: inbound.id },
    );

    expect(reply.status).toBe('reply');
    expect(reply.route).toBe('static');
    expect(reply.replayed).toBe(false);
    expect(replay).toEqual({ ...reply, replayed: true });
    const [trace] = await admin<
      {
        provider: string;
        model: string;
        outcome: string;
        toolCallCount: number;
      }[]
    >`
      select
        run.provider, run.model, run.outcome::text,
        count(tool.id)::int as "toolCallCount"
      from ai_runs as run
      left join ai_tool_calls as tool
        on tool.tenant_id = run.tenant_id and tool.run_id = run.id
      where run.tenant_id = ${tenantA} and run.id = ${reply.runId}
      group by run.id
    `;
    expect(trace).toEqual({
      provider: 'deterministic',
      model: 'static-reply-v1',
      outcome: 'completed',
      toolCallCount: 0,
    });
    await expect(
      customerAgent.reply(identity, 'agent-cross-tenant', tenantB, conversation.id, {
        messageId: inbound.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
