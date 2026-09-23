import { NotFoundException } from '@nestjs/common';
import { createDatabaseClient } from '@ai-business/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';
import { OperationsService } from '../src/operations/operations.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const tenantA = 'a1111111-1111-4111-8111-111111111111';
const tenantB = 'a2222222-2222-4222-8222-222222222222';
const userId = 'a3333333-3333-4333-8333-333333333333';
const productTypeId = 'a4444444-4444-4444-8444-444444444444';
const productId = 'a5555555-5555-4555-8555-555555555555';
const variantId = 'a6666666-6666-4666-8666-666666666666';
const locationId = 'a7777777-7777-4777-8777-777777777777';
const customerId = 'a8888888-8888-4888-8888-888888888888';
const draftId = 'a9999999-9999-4999-8999-999999999999';
const orderId = 'aa111111-1111-4111-8111-111111111111';
const conversationId = 'aa222222-2222-4222-8222-222222222222';
const customerMessageId = 'aa333333-3333-4333-8333-333333333333';
const botMessageId = 'aa444444-4444-4444-8444-444444444444';
const aiRunId = 'aa555555-5555-4555-8555-555555555555';
const toolCallId = 'aa666666-6666-4666-8666-666666666666';
const handoffRunId = 'aa777777-7777-4777-8777-777777777777';
const handoffId = 'aa888888-8888-4888-8888-888888888888';
const correlationId = 'pilot-trace-order-1';
const identity = {
  subject: 'api-operations-user',
  issuer: 'https://identity.example.test',
} as const;

describeWithDatabase('pilot operations dashboard and trace', () => {
  if (!databaseUrl) return;

  const admin = createDatabaseClient(databaseUrl);
  let database: DatabaseService;
  let operations: OperationsService;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.PILOT_HANDOFF_WAIT_ALERT_SECONDS = '60';
    await admin`
      insert into tenants (id, name, timezone)
      values
        (${tenantA}, 'Operations Integration A', 'Africa/Algiers'),
        (${tenantB}, 'Operations Integration B', 'Africa/Algiers')
      on conflict (id) do update set name = excluded.name
    `;
    await admin`
      insert into app_users (id, identity_provider_id, email)
      values (${userId}, ${identity.subject}, 'operations@example.test')
      on conflict (identity_provider_id) do update set email = excluded.email
    `;
    await admin`
      insert into memberships (tenant_id, user_id, role, status)
      values
        (${tenantA}, ${userId}, 'owner', 'active'),
        (${tenantB}, ${userId}, 'owner', 'active')
      on conflict (tenant_id, user_id) do update set status = 'active', role = 'owner'
    `;
    await admin`
      insert into product_types (id, tenant_id, name, slug)
      values (${productTypeId}, ${tenantA}, 'Pilot products', 'pilot-products')
    `;
    await admin`
      insert into products (
        id, tenant_id, product_type_id, code, name, base_price, currency,
        status, custom_attributes, product_type_schema_version, published_at
      ) values (
        ${productId}, ${tenantA}, ${productTypeId}, 'OPS-1', 'Operations Product',
        1250, 'DZD', 'active', '{}'::jsonb, 1, now()
      )
    `;
    await admin`
      insert into product_variants (
        id, tenant_id, product_id, sku, name, attributes, status
      ) values (
        ${variantId}, ${tenantA}, ${productId}, 'OPS-SKU-1', 'Default',
        '{}'::jsonb, 'active'
      )
    `;
    await admin`
      insert into inventory_locations (id, tenant_id, code, name, is_default)
      values (${locationId}, ${tenantA}, 'OPS-MAIN', 'Main', true)
    `;
    await admin`
      insert into inventory_balances (
        tenant_id, location_id, variant_id, on_hand, reserved, reorder_point
      ) values (${tenantA}, ${locationId}, ${variantId}, 2, 0, 5)
    `;
    await admin`
      insert into customers (id, tenant_id, name)
      values (${customerId}, ${tenantA}, 'Operations Customer')
    `;
    await admin`
      insert into draft_orders (
        id, tenant_id, customer_id, status, customer_name, customer_phone,
        shipping_address, currency, subtotal, discount_amount, shipping_amount,
        total, customer_approved_at, approval_source
      ) values (
        ${draftId}, ${tenantA}, ${customerId}, 'confirmed', 'Operations Customer',
        '+213555000009', '{"line1":"Pilot Street","city":"Algiers","countryCode":"DZ"}'::jsonb,
        'DZD', 1250, 0, 0, 1250, now(), 'integration-test'
      )
    `;
    await admin`
      insert into orders (
        id, tenant_id, source_draft_order_id, customer_id, number, status,
        customer_name, customer_phone, shipping_address, currency, subtotal,
        discount_amount, shipping_amount, total, confirmed_at
      ) values (
        ${orderId}, ${tenantA}, ${draftId}, ${customerId}, 'OPS-ORDER-1', 'confirmed',
        'Operations Customer', '+213555000009',
        '{"line1":"Pilot Street","city":"Algiers","countryCode":"DZ"}'::jsonb,
        'DZD', 1250, 0, 0, 1250, now()
      )
    `;
    await admin`
      insert into conversations (
        id, tenant_id, customer_id, channel, status, product_id, draft_order_id, order_id
      ) values (
        ${conversationId}, ${tenantA}, ${customerId}, 'internal', 'needs_human',
        ${productId}, ${draftId}, ${orderId}
      )
    `;
    await admin`
      insert into messages (
        id, tenant_id, conversation_id, direction, sender_type, external_id,
        fingerprint, content, metadata
      ) values (
        ${customerMessageId}, ${tenantA}, ${conversationId}, 'inbound', 'customer',
        'ops-customer-message', 'ops-customer-fingerprint', 'Please confirm this order.',
        '{}'::jsonb
      )
    `;
    await admin`
      insert into ai_runs (
        id, tenant_id, conversation_id, task, intent, prompt_version,
        routing_version, provider, model, model_version, outcome, handoff_reason,
        latency_ms, input_tokens, output_tokens, estimated_cost_usd,
        attempt_count, fallback_used, safe_input, safe_output, attempts,
        correlation_id
      ) values (
        ${aiRunId}, ${tenantA}, ${conversationId}, 'compose', 'order_confirmation',
        'ops-v1', 'ops-routing-v1', 'integration', 'integration-model', '1',
        'completed', null, 240, 40, 15, 0.0025, 1, false,
        '{"messageId":"aa333333-3333-4333-8333-333333333333"}'::jsonb,
        '{"status":"reply"}'::jsonb, '[]'::jsonb, ${correlationId}
      )
    `;
    await admin`
      insert into ai_tool_calls (
        id, tenant_id, run_id, provider_call_id, name, kind, status,
        latency_ms, safe_input, safe_output, error_code
      ) values (
        ${toolCallId}, ${tenantA}, ${aiRunId}, 'ops-provider-call',
        'confirm_draft_order', 'command', 'failed', 35, '{}'::jsonb,
        '{}'::jsonb, 'timeout'
      )
    `;
    await admin`
      insert into messages (
        id, tenant_id, conversation_id, direction, sender_type, external_id,
        fingerprint, content, metadata
      ) values (
        ${botMessageId}, ${tenantA}, ${conversationId}, 'outbound', 'bot',
        'ops-bot-message', 'ops-bot-fingerprint', 'Your request is being reviewed.',
        ${admin.json({
          inReplyToMessageId: customerMessageId,
          agentReply: { runId: aiRunId },
        })}
      )
    `;
    await admin`
      insert into order_commands (
        tenant_id, order_id, draft_order_id, type, idempotency_key,
        command_fingerprint, result_status, actor_id, correlation_id
      ) values (
        ${tenantA}, ${orderId}, ${draftId}, 'confirm', 'ops-order-confirm',
        'ops-command-fingerprint', 'confirmed', ${identity.subject}, ${correlationId}
      )
    `;
    await admin`
      insert into audit_events (
        tenant_id, actor_type, actor_id, action, entity_type, entity_id,
        correlation_id, metadata
      ) values (
        ${tenantA}, 'user', ${identity.subject}, 'order.confirmed', 'order',
        ${orderId}, ${correlationId}, '{}'::jsonb
      )
    `;
    await admin`
      insert into ai_runs (
        id, tenant_id, conversation_id, task, intent, prompt_version,
        routing_version, provider, model, model_version, outcome, handoff_reason,
        latency_ms, input_tokens, output_tokens, estimated_cost_usd,
        attempt_count, fallback_used, safe_input, safe_output, attempts,
        correlation_id
      ) values (
        ${handoffRunId}, ${tenantA}, ${conversationId}, 'compose', 'handoff',
        'ops-v1', null, null, null, null, 'handoff', 'safety_fallback',
        15, 10, 0, 0, 0, false, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb,
        'pilot-handoff-alert'
      )
    `;
    await admin`
      insert into handoffs (
        id, tenant_id, conversation_id, source_message_id, source_run_id,
        reason, status, intent, summary, idempotency_key, requested_at
      ) values (
        ${handoffId}, ${tenantA}, ${conversationId}, ${customerMessageId},
        ${handoffRunId}, 'low_confidence', 'pending', 'handoff',
        '{"schemaVersion":1,"customerRequest":"Need help"}'::jsonb,
        'ops-handoff', now() - interval '20 minutes'
      )
    `;
    database = new DatabaseService();
    operations = new OperationsService(database);
  });

  afterAll(async () => {
    await admin`delete from handoffs where tenant_id = ${tenantA}`;
    await admin`delete from ai_tool_calls where tenant_id = ${tenantA}`;
    await admin`delete from ai_runs where tenant_id = ${tenantA}`;
    await admin`delete from audit_events where tenant_id = ${tenantA}`;
    await admin`delete from messages where tenant_id = ${tenantA}`;
    await admin`delete from conversations where tenant_id = ${tenantA}`;
    await admin`delete from order_commands where tenant_id = ${tenantA}`;
    await admin`delete from order_transitions where tenant_id = ${tenantA}`;
    await admin`delete from orders where tenant_id = ${tenantA}`;
    await admin`delete from draft_order_items where tenant_id = ${tenantA}`;
    await admin`delete from draft_orders where tenant_id = ${tenantA}`;
    await admin`delete from inventory_balances where tenant_id = ${tenantA}`;
    await admin`delete from inventory_locations where tenant_id = ${tenantA}`;
    await admin`delete from product_variants where tenant_id = ${tenantA}`;
    await admin`delete from products where tenant_id = ${tenantA}`;
    await admin`delete from product_types where tenant_id = ${tenantA}`;
    await admin`delete from customers where tenant_id = ${tenantA}`;
    await admin`delete from memberships where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from app_users where id = ${userId}`;
    await database.onApplicationShutdown();
    await admin.end();
    delete process.env.PILOT_HANDOFF_WAIT_ALERT_SECONDS;
  });

  it('returns the required Pilot KPIs and operational alerts', async () => {
    const dashboard = await operations.getDashboard(identity, 'dashboard-request', tenantA, {
      range: '30d',
    });
    expect(dashboard.timezone).toBe('Africa/Algiers');
    expect(dashboard.orders).toMatchObject({
      total: 1,
      active: 1,
      delivered: 0,
      cancelled: 0,
    });
    expect(dashboard.salesByCurrency).toEqual([
      { currency: 'DZD', amount: '1250.00', orderCount: 1 },
    ]);
    expect(dashboard.stock).toEqual({ alertCount: 1, outOfStockCount: 0 });
    expect(dashboard.handoffs.pending).toBe(1);
    expect(dashboard.ai).toMatchObject({
      runCount: 2,
      handoffCount: 1,
      handoffRate: 0.5,
      failedToolCalls: 1,
    });
    expect(dashboard.daily).toHaveLength(30);
    expect(new Set(dashboard.alerts.map((alert) => alert.kind))).toEqual(
      new Set(['low_stock', 'handoff_wait', 'ai_tool_failure']),
    );
  });

  it('traces a customer message through the AI tool and order without leaking another tenant', async () => {
    const trace = await operations.getTrace(identity, 'trace-request', tenantA, correlationId);
    expect(trace.messages.map((message) => message.id)).toEqual([customerMessageId, botMessageId]);
    expect(trace.aiRuns).toHaveLength(1);
    expect(trace.toolCalls).toEqual([
      expect.objectContaining({ id: toolCallId, name: 'confirm_draft_order', status: 'failed' }),
    ]);
    expect(trace.orders).toEqual([expect.objectContaining({ id: orderId, number: 'OPS-ORDER-1' })]);
    expect(trace.timeline.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['message', 'ai_run', 'tool_call', 'order', 'audit']),
    );
    await expect(
      operations.getTrace(identity, 'trace-cross-tenant', tenantB, correlationId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
