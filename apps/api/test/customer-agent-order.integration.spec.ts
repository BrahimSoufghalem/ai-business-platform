import { createDatabaseClient } from '@ai-business/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentSettingsService } from '../src/configuration/agent-settings.service.js';
import { BusinessRuleService } from '../src/configuration/business-rule.service.js';
import { KnowledgeService } from '../src/configuration/knowledge.service.js';
import { ConversationService } from '../src/conversations/conversation.service.js';
import { CustomerAgentService } from '../src/customer-agent/customer-agent.service.js';
import { CustomerService } from '../src/customers/customer.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { OrderService } from '../src/orders/order.service.js';
import { ProductService } from '../src/products/product.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const tenantId = '67676767-6767-4767-8767-676767676767';
const userId = '68686868-6868-4868-8868-686868686868';
const productTypeId = '69696969-6969-4969-8969-696969696969';
const productId = '70707070-7070-4070-8070-707070707070';
const variantId = '71717171-7171-4171-8171-717171717171';
const locationId = '72727272-7272-4272-8272-727272727272';
const identity = {
  subject: 'api-customer-agent-order-user',
  issuer: 'https://identity.example.test',
} as const;

const policy = {
  currency: 'DZD',
  negotiable: true,
  minimumPrice: { type: 'percentage_of_list' as const, percentage: 85 },
  maxDiscountPercent: 10,
  escalation: {
    belowMinimum: 'reject' as const,
    whenNotNegotiable: 'reject' as const,
    maxCounterOffers: 1,
  },
};

describeWithDatabase('customer agent conversation-to-order flow', () => {
  if (!databaseUrl) return;

  const admin = createDatabaseClient(databaseUrl);
  let database: DatabaseService;
  let customers: CustomerService;
  let conversations: ConversationService;
  let customerAgent: CustomerAgentService;
  let rules: BusinessRuleService;
  let customerId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    await admin`
      insert into tenants (id, name)
      values (${tenantId}, 'Customer Agent Order Integration')
      on conflict (id) do update set name = excluded.name
    `;
    await admin`
      insert into app_users (id, identity_provider_id, email)
      values (${userId}, ${identity.subject}, 'agent-order@example.test')
      on conflict (identity_provider_id) do update set email = excluded.email
    `;
    await admin`
      insert into memberships (tenant_id, user_id, role, status)
      values (${tenantId}, ${userId}, 'owner', 'active')
      on conflict (tenant_id, user_id) do update set status = 'active', role = 'owner'
    `;
    await admin`
      insert into product_types (
        id, tenant_id, name, slug, schema_version, status
      ) values (
        ${productTypeId}, ${tenantId}, 'Agent Order Products',
        'agent-order-products', 1, 'active'
      )
      on conflict (id) do nothing
    `;
    await admin`
      insert into products (
        id, tenant_id, product_type_id, code, name, description,
        base_price, currency, status, custom_attributes,
        product_type_schema_version, version, published_at
      ) values (
        ${productId}, ${tenantId}, ${productTypeId}, 'ALPHA-ORDER-TEST',
        'هاتف Alpha', 'هاتف لاختبار الطلب من المحادثة',
        100000, 'DZD', 'active', '{}'::jsonb, 1, 1, now()
      )
      on conflict (id) do nothing
    `;
    await admin`
      insert into product_variants (
        id, tenant_id, product_id, sku, name, attributes, status
      ) values (
        ${variantId}, ${tenantId}, ${productId}, 'ALPHA-ORDER-BLK',
        'أسود', '{"color":"أسود"}'::jsonb, 'active'
      )
      on conflict (id) do nothing
    `;
    await admin`
      insert into inventory_locations (
        id, tenant_id, code, name, is_default, status
      ) values (
        ${locationId}, ${tenantId}, 'MAIN', 'Main warehouse', true, 'active'
      )
      on conflict (id) do nothing
    `;
    await admin`
      insert into inventory_balances (
        tenant_id, location_id, variant_id, on_hand, reserved, reorder_point
      ) values (${tenantId}, ${locationId}, ${variantId}, 10, 0, 0)
      on conflict (tenant_id, location_id, variant_id)
      do update set on_hand = 10, reserved = 0, reorder_point = 0
    `;

    database = new DatabaseService();
    customers = new CustomerService(database);
    conversations = new ConversationService(database);
    rules = new BusinessRuleService(database);
    customerAgent = new CustomerAgentService(
      database,
      conversations,
      new ProductService(database),
      new InventoryService(database),
      new OrderService(database),
      rules,
      new KnowledgeService(database),
      new AgentSettingsService(database),
    );

    const customer = await customers.create(identity, 'agent-order-customer', tenantId, {
      name: 'عميل الطلب',
      contacts: [{ type: 'phone', value: '0555123456', isPrimary: true }],
      addresses: [
        {
          line1: '10 شارع الاستقلال',
          city: 'الجزائر',
          countryCode: 'DZ',
          isDefault: true,
        },
      ],
      metadata: {},
    });
    customerId = customer.customer.id;

    const rule = await rules.create(identity, 'agent-order-rule-create', tenantId, {
      key: 'default-pricing',
      name: 'Agent order pricing',
      description: 'Published policy used by the customer order agent.',
      policy,
      changeNote: 'Initial integration policy',
    });
    if (!rule.draft) throw new Error('Pricing rule draft was not created.');
    await rules.publish(identity, 'agent-order-rule-publish', tenantId, rule.id, rule.draft.id, {
      expectedSetVersion: rule.version,
    });
  });

  afterAll(async () => {
    await admin`delete from ai_tool_calls where tenant_id = ${tenantId}`;
    await admin`delete from ai_runs where tenant_id = ${tenantId}`;
    await admin`delete from messages where tenant_id = ${tenantId}`;
    await admin`delete from conversation_transitions where tenant_id = ${tenantId}`;
    await admin`delete from order_items where tenant_id = ${tenantId}`;
    await admin`delete from draft_order_items where tenant_id = ${tenantId}`;
    await admin`delete from pricing_decisions where tenant_id = ${tenantId}`;
    await admin`
      update conversations
      set draft_order_id = null, order_id = null, product_id = null
      where tenant_id = ${tenantId}
    `;
    await admin`delete from conversations where tenant_id = ${tenantId}`;
    await admin`delete from order_commands where tenant_id = ${tenantId}`;
    await admin`delete from order_transitions where tenant_id = ${tenantId}`;
    await admin`delete from orders where tenant_id = ${tenantId}`;
    await admin`delete from draft_orders where tenant_id = ${tenantId}`;
    await admin`delete from inventory_movements where tenant_id = ${tenantId}`;
    await admin`delete from stock_reservations where tenant_id = ${tenantId}`;
    await admin`delete from inventory_balances where tenant_id = ${tenantId}`;
    await admin`delete from inventory_locations where tenant_id = ${tenantId}`;
    await admin`delete from business_rule_versions where tenant_id = ${tenantId}`;
    await admin`delete from business_rule_sets where tenant_id = ${tenantId}`;
    await admin`delete from product_variants where tenant_id = ${tenantId}`;
    await admin`delete from products where tenant_id = ${tenantId}`;
    await admin`delete from product_types where tenant_id = ${tenantId}`;
    await admin`delete from customer_addresses where tenant_id = ${tenantId}`;
    await admin`delete from customer_contacts where tenant_id = ${tenantId}`;
    await admin`delete from customers where tenant_id = ${tenantId}`;
    await admin`delete from audit_events where tenant_id = ${tenantId}`;
    await admin`delete from memberships where tenant_id = ${tenantId}`;
    await admin`delete from tenants where id = ${tenantId}`;
    await admin`delete from app_users where id = ${userId}`;
    await database.onApplicationShutdown();
    await admin.end();
  });

  it('creates one negotiated draft, requires a confirmation message, and confirms idempotently', async () => {
    const conversation = await conversations.create(
      identity,
      'agent-order-conversation',
      tenantId,
      {
        customerId,
        channel: 'internal',
        externalThreadId: 'agent-order-flow',
        status: 'bot',
        subject: 'Conversational order',
        productId: null,
        draftOrderId: null,
        orderId: null,
        initialMessage: {
          direction: 'inbound',
          senderType: 'customer',
          senderId: null,
          externalId: 'agent-order-purchase',
          content: 'أريد شراء ALPHA-ORDER-TEST الأسود، الكمية: 2، بسعر 92000 DZD',
          metadata: {},
        },
      },
    );
    const purchaseMessage = conversation.messages[0];
    if (!purchaseMessage) throw new Error('Purchase message was not created.');

    const summary = await customerAgent.reply(
      identity,
      'agent-order-summary',
      tenantId,
      conversation.id,
      { messageId: purchaseMessage.id },
    );
    const summaryReplay = await customerAgent.reply(
      identity,
      'agent-order-summary-replay',
      tenantId,
      conversation.id,
      { messageId: purchaseMessage.id },
    );

    expect(summary.status).toBe('reply');
    expect(summary.draftOrderId).not.toBeNull();
    expect(summary.orderId).toBeNull();
    expect(summary.text).toContain('2 × هاتف Alpha');
    expect(summary.text).toContain('184000.00 DZD');
    expect(summary.text).toContain('أؤكد الطلب');
    expect(summaryReplay).toEqual({ ...summary, replayed: true });

    const [draftState] = await admin<
      {
        status: string;
        version: number;
        quantity: number;
        listPrice: string;
        unitPrice: string;
        subtotal: string;
        discountAmount: string;
        total: string;
        pricingDecisionId: string | null;
      }[]
    >`
      select
        draft.status::text, draft.version, item.quantity,
        item.list_price::text as "listPrice",
        item.unit_price::text as "unitPrice",
        draft.subtotal::text, draft.discount_amount::text as "discountAmount",
        draft.total::text, item.pricing_decision_id::text as "pricingDecisionId"
      from draft_orders as draft
      join draft_order_items as item
        on item.tenant_id = draft.tenant_id and item.draft_order_id = draft.id
      where draft.tenant_id = ${tenantId} and draft.id = ${summary.draftOrderId}
    `;
    expect(draftState).toMatchObject({
      status: 'awaiting_confirmation',
      quantity: 2,
      listPrice: '100000.00',
      unitPrice: '92000.00',
      subtotal: '200000.00',
      discountAmount: '16000.00',
      total: '184000.00',
    });
    expect(draftState?.pricingDecisionId).not.toBeNull();

    const approvalMessage = await conversations.appendMessage(
      identity,
      'agent-order-approval-message',
      tenantId,
      conversation.id,
      {
        direction: 'inbound',
        senderType: 'customer',
        senderId: null,
        externalId: 'agent-order-approval',
        content: 'أؤكد الطلب',
        metadata: {},
      },
    );
    const confirmed = await customerAgent.reply(
      identity,
      'agent-order-confirm',
      tenantId,
      conversation.id,
      { messageId: approvalMessage.id },
    );
    expect(confirmed.status).toBe('reply');
    expect(confirmed.orderId).not.toBeNull();
    expect(confirmed.orderNumber).toMatch(/^ORD-/u);
    expect(confirmed.text).toContain('184000.00 DZD');

    const repeatedApproval = await conversations.appendMessage(
      identity,
      'agent-order-repeated-approval-message',
      tenantId,
      conversation.id,
      {
        direction: 'inbound',
        senderType: 'customer',
        senderId: null,
        externalId: 'agent-order-approval-repeat',
        content: 'أؤكد الطلب',
        metadata: {},
      },
    );
    const repeated = await customerAgent.reply(
      identity,
      'agent-order-confirm-repeat',
      tenantId,
      conversation.id,
      { messageId: repeatedApproval.id },
    );
    expect(repeated.orderId).toBe(confirmed.orderId);
    expect(repeated.orderNumber).toBe(confirmed.orderNumber);

    const [finalState] = await admin<
      {
        orderCount: number;
        reservationCount: number;
        quantity: number;
        listPrice: string;
        unitPrice: string;
        total: string;
        reserved: number;
      }[]
    >`
      select
        (select count(*)::int from orders where tenant_id = ${tenantId}) as "orderCount",
        (
          select count(*)::int from stock_reservations
          where tenant_id = ${tenantId} and reference_type = 'order'
        ) as "reservationCount",
        item.quantity, item.list_price::text as "listPrice",
        item.unit_price::text as "unitPrice", orders.total::text,
        balance.reserved
      from orders
      join order_items as item
        on item.tenant_id = orders.tenant_id and item.order_id = orders.id
      join inventory_balances as balance
        on balance.tenant_id = item.tenant_id
        and balance.location_id = item.location_id
        and balance.variant_id = item.variant_id
      where orders.tenant_id = ${tenantId} and orders.id = ${confirmed.orderId}
    `;
    expect(finalState).toEqual({
      orderCount: 1,
      reservationCount: 1,
      quantity: 2,
      listPrice: '100000.00',
      unitPrice: '92000.00',
      total: '184000.00',
      reserved: 2,
    });
  });

  it('rejects an outside-policy offer without creating a draft or order', async () => {
    const [beforeCounts] = await admin<{ draftCount: number; orderCount: number }[]>`
      select
        (
          select count(*)::int from draft_orders
          where tenant_id = ${tenantId}
        ) as "draftCount",
        (
          select count(*)::int from orders
          where tenant_id = ${tenantId}
        ) as "orderCount"
    `;
    const conversation = await conversations.create(
      identity,
      'agent-order-rejected-conversation',
      tenantId,
      {
        customerId,
        channel: 'internal',
        externalThreadId: 'agent-order-rejected-flow',
        status: 'bot',
        subject: 'Rejected price offer',
        productId: null,
        draftOrderId: null,
        orderId: null,
        initialMessage: {
          direction: 'inbound',
          senderType: 'customer',
          senderId: null,
          externalId: 'agent-order-rejected-offer',
          content: 'أريد شراء ALPHA-ORDER-TEST الأسود بسعر 50000 DZD',
          metadata: {},
        },
      },
    );
    const offerMessage = conversation.messages[0];
    if (!offerMessage) throw new Error('Offer message was not created.');

    const reply = await customerAgent.reply(
      identity,
      'agent-order-rejected-reply',
      tenantId,
      conversation.id,
      { messageId: offerMessage.id },
    );

    expect(reply.status).toBe('clarification');
    expect(reply.text).toContain('خارج سياسة السعر');
    expect(reply.draftOrderId).toBeNull();
    expect(reply.orderId).toBeNull();
    const reloaded = await conversations.get(
      identity,
      'agent-order-rejected-reload',
      tenantId,
      conversation.id,
    );
    expect(reloaded.draftOrderId).toBeNull();
    expect(reloaded.orderId).toBeNull();
    const [counts] = await admin<{ draftCount: number; orderCount: number }[]>`
      select
        (
          select count(*)::int from draft_orders
          where tenant_id = ${tenantId}
        ) as "draftCount",
        (
          select count(*)::int from orders
          where tenant_id = ${tenantId}
        ) as "orderCount"
    `;
    expect(counts).toEqual(beforeCounts);
  });
});
