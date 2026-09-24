import { createDatabaseClient } from '@ai-business/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentSettingsService } from '../src/configuration/agent-settings.service.js';
import { BusinessRuleService } from '../src/configuration/business-rule.service.js';
import { KnowledgeService } from '../src/configuration/knowledge.service.js';
import { ConversationService } from '../src/conversations/conversation.service.js';
import { CustomerAgentJobProcessorService } from '../src/customer-agent/customer-agent-job-processor.service.js';
import { CustomerAgentService } from '../src/customer-agent/customer-agent.service.js';
import { CustomerService } from '../src/customers/customer.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { OrderService } from '../src/orders/order.service.js';
import { ProductService } from '../src/products/product.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const tenantId = '20202020-2020-4020-8020-202020202020';
const userId = '21212121-2121-4121-8121-212121212121';
const identity = {
  subject: 'api-customer-agent-job-owner',
  issuer: 'https://identity.example.test',
} as const;

describeWithDatabase('customer-agent durable job processing', () => {
  if (!databaseUrl) return;

  const admin = createDatabaseClient(databaseUrl);
  let database: DatabaseService;
  let conversationId: string;
  let sourceMessageId: string;
  let processor: CustomerAgentJobProcessorService;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    await admin`
      insert into tenants (id, name)
      values (${tenantId}, 'Customer Agent Job Integration')
      on conflict (id) do update set name = excluded.name
    `;
    await admin`
      insert into app_users (id, identity_provider_id, email)
      values (${userId}, ${identity.subject}, 'agent-job@example.test')
      on conflict (identity_provider_id) do update set email = excluded.email
    `;
    await admin`
      insert into memberships (tenant_id, user_id, role, status)
      values (${tenantId}, ${userId}, 'owner', 'active')
      on conflict (tenant_id, user_id) do update set status = 'active', role = 'owner'
    `;

    database = new DatabaseService();
    const conversations = new ConversationService(database);
    const customerAgent = new CustomerAgentService(
      database,
      conversations,
      new ProductService(database),
      new InventoryService(database),
      new OrderService(database),
      new BusinessRuleService(database),
      new KnowledgeService(database),
      new AgentSettingsService(database),
    );
    processor = new CustomerAgentJobProcessorService(database, customerAgent);
    const customers = new CustomerService(database);
    const customer = await customers.create(identity, 'agent-job-customer', tenantId, {
      name: 'عميل إنستغرام',
      contacts: [{ type: 'instagram', value: '99112233', isPrimary: true }],
      addresses: [],
      metadata: {},
    });
    const conversation = await conversations.create(identity, 'agent-job-conversation', tenantId, {
      customerId: customer.customer.id,
      channel: 'instagram',
      externalThreadId: '99112233',
      status: 'bot',
      subject: 'Instagram greeting',
      productId: null,
      draftOrderId: null,
      orderId: null,
      initialMessage: {
        direction: 'inbound',
        senderType: 'customer',
        senderId: '99112233',
        externalId: 'meta-agent-job-1',
        content: 'مرحبا',
        metadata: {},
      },
    });
    const source = conversation.messages[0];
    if (!source) throw new Error('Inbound source message was not created.');
    conversationId = conversation.id;
    sourceMessageId = source.id;
    await admin`
      insert into message_processing_jobs (
        tenant_id, conversation_id, source_message_id, correlation_id
      ) values (
        ${tenantId}, ${conversationId}, ${sourceMessageId}, 'agent-job-e2e'
      )
    `;
  });

  afterAll(async () => {
    await admin`delete from ai_tool_calls where tenant_id = ${tenantId}`;
    await admin`delete from ai_runs where tenant_id = ${tenantId}`;
    await admin`delete from audit_events where tenant_id = ${tenantId}`;
    await admin`delete from messages where tenant_id = ${tenantId}`;
    await admin`delete from conversation_transitions where tenant_id = ${tenantId}`;
    await admin`delete from conversations where tenant_id = ${tenantId}`;
    await admin`delete from customer_contacts where tenant_id = ${tenantId}`;
    await admin`delete from customers where tenant_id = ${tenantId}`;
    await admin`delete from memberships where tenant_id = ${tenantId}`;
    await admin`delete from tenants where id = ${tenantId}`;
    await admin`delete from app_users where id = ${userId}`;
    await database.onApplicationShutdown();
    await admin.end();
  });

  it('turns one claimed inbound job into one outbound reply and delivery job', async () => {
    await expect(processor.processNext('worker:integration')).resolves.toMatchObject({
      status: 'completed',
    });

    const [processingJob] = await admin<{ status: string; attempts: number }[]>`
      select status::text, attempts
      from message_processing_jobs
      where tenant_id = ${tenantId} and source_message_id = ${sourceMessageId}
    `;
    expect(processingJob).toEqual({ status: 'completed', attempts: 1 });

    const replies = await admin<{ id: string; content: string; actorType: string }[]>`
      select
        message.id::text,
        message.content,
        audit.actor_type as "actorType"
      from messages as message
      join audit_events as audit
        on audit.tenant_id = message.tenant_id
        and audit.entity_id = message.id::text
        and audit.action = 'conversation.message.created'
      where message.tenant_id = ${tenantId}
        and message.conversation_id = ${conversationId}
        and message.direction = 'outbound'
        and message.sender_type = 'bot'
    `;
    expect(replies).toHaveLength(1);
    expect(replies[0]?.content).toContain('مرحب');
    expect(replies[0]?.actorType).toBe('service');

    const [deliveryJob] = await admin<{ status: string }[]>`
      select delivery.status::text
      from instagram_delivery_jobs as delivery
      where delivery.tenant_id = ${tenantId}
        and delivery.message_id = ${replies[0]?.id ?? null}::uuid
    `;
    expect(deliveryJob?.status).toBe('pending');
  });
});
