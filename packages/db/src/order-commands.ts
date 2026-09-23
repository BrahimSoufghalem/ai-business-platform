import { createHash } from 'node:crypto';
import {
  InvalidOrderTransitionError,
  assertOrderTransition,
  calculateQuotedOrderTotals,
  type DraftOrderStatus,
  type OrderStatus,
} from '@ai-business/domain';
import {
  commitInventoryReservation,
  releaseInventoryReservation,
  reserveInventory,
} from './inventory-commands.js';
import type { TenantTransaction } from './client.js';

export interface OrderCommandContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface OrderCommandResult {
  readonly replayed: boolean;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly version: number;
}

interface DraftOrderRow {
  id: string;
  customerId: string | null;
  status: DraftOrderStatus;
  version: number;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  shippingAddress: Record<string, unknown> | null;
  notes: string | null;
  customFields: Record<string, unknown>;
  currency: string;
  subtotal: string;
  discountAmount: string;
  shippingAmount: string;
  total: string;
}

interface DraftOrderItemRow {
  id: string;
  productId: string;
  variantId: string;
  locationId: string;
  productNameSnapshot: string;
  productCodeSnapshot: string;
  variantNameSnapshot: string | null;
  skuSnapshot: string;
  variantAttributesSnapshot: Record<string, unknown>;
  quantity: number;
  listPrice: string;
  unitPrice: string;
  lineTotal: string;
  currency: string;
  pricingDecisionId: string | null;
  currentListPrice: string;
  decisionProductId: string | null;
  decisionVariantId: string | null;
  decisionConversationId: string | null;
  decisionCurrency: string | null;
  decisionListPrice: string | null;
  decisionDecidedPrice: string | null;
  decisionOutcome: 'accept' | 'counter' | 'handoff' | 'reject' | null;
  pricingRuleStatus: 'draft' | 'published' | 'superseded' | null;
  pricingConversationLinked: boolean;
  productStatus: 'draft' | 'active' | 'archived';
  variantStatus: 'active' | 'archived';
}

interface OrderRow {
  id: string;
  number: string;
  status: OrderStatus;
  version: number;
}

interface ExistingCommandRow extends OrderRow {
  commandFingerprint: string;
}

type JsonInput = Parameters<TenantTransaction['json']>[0];

function jsonInput(value: unknown): JsonInput {
  return value as JsonInput;
}

export class DraftOrderNotFoundError extends Error {
  constructor() {
    super('Draft order not found.');
    this.name = 'DraftOrderNotFoundError';
  }
}

export class DraftOrderStateError extends Error {
  constructor(readonly status: DraftOrderStatus) {
    super(`Draft order is ${status} and cannot be confirmed.`);
    this.name = 'DraftOrderStateError';
  }
}

export class DraftOrderVersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super('Draft order changed; request confirmation again.');
    this.name = 'DraftOrderVersionConflictError';
  }
}

export class DraftOrderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftOrderValidationError';
  }
}

export class OrderNotFoundError extends Error {
  constructor() {
    super('Order not found.');
    this.name = 'OrderNotFoundError';
  }
}

export class OrderIdempotencyConflictError extends Error {
  constructor() {
    super('The idempotency key was already used for a different order command.');
    this.name = 'OrderIdempotencyConflictError';
  }
}

function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 128) {
    throw new DraftOrderValidationError(
      'Idempotency key must contain between 8 and 128 characters.',
    );
  }
  return normalized;
}

function commandFingerprint(value: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function inventoryIdempotencyKey(
  context: OrderCommandContext,
  commandKey: string,
  action: 'reserve' | 'commit' | 'release',
  entityId: string,
): string {
  const digest = createHash('sha256')
    .update(`${context.tenantId}:${commandKey}:${action}:${entityId}`)
    .digest('hex');
  return `order-${action}-${digest}`;
}

async function acquireCommandLock(
  transaction: TenantTransaction,
  tenantId: string,
  idempotencyKey: string,
): Promise<void> {
  await transaction`
    select pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:order:${idempotencyKey}`}, 0::bigint)
    )
  `;
}

async function replayIfPresent(
  transaction: TenantTransaction,
  context: OrderCommandContext,
  idempotencyKey: string,
  fingerprint: string,
): Promise<OrderCommandResult | null> {
  await acquireCommandLock(transaction, context.tenantId, idempotencyKey);
  const [existing] = await transaction<ExistingCommandRow[]>`
    select
      command.command_fingerprint as "commandFingerprint",
      orders.id::text, orders.number, orders.status::text, orders.version
    from order_commands as command
    join orders
      on orders.tenant_id = command.tenant_id and orders.id = command.order_id
    where command.tenant_id = ${context.tenantId}
      and command.idempotency_key = ${idempotencyKey}
    limit 1
  `;
  if (!existing) return null;
  if (existing.commandFingerprint !== fingerprint) {
    throw new OrderIdempotencyConflictError();
  }
  return {
    replayed: true,
    orderId: existing.id,
    orderNumber: existing.number,
    status: existing.status,
    version: existing.version,
  };
}

function hasCompleteAddress(address: Record<string, unknown> | null): boolean {
  return (
    address !== null &&
    typeof address.line1 === 'string' &&
    address.line1.trim().length > 0 &&
    typeof address.city === 'string' &&
    address.city.trim().length > 0 &&
    typeof address.countryCode === 'string' &&
    address.countryCode.trim().length === 2
  );
}

async function insertCommand(
  transaction: TenantTransaction,
  context: OrderCommandContext,
  input: {
    readonly orderId: string;
    readonly draftOrderId?: string | null | undefined;
    readonly type: 'confirm' | 'transition' | 'cancel';
    readonly idempotencyKey: string;
    readonly fingerprint: string;
    readonly resultStatus: OrderStatus;
  },
): Promise<void> {
  await transaction`
    insert into order_commands (
      tenant_id, order_id, draft_order_id, type, idempotency_key,
      command_fingerprint, result_status, actor_id, correlation_id
    ) values (
      ${context.tenantId}, ${input.orderId}, ${input.draftOrderId ?? null},
      ${input.type}, ${input.idempotencyKey}, ${input.fingerprint},
      ${input.resultStatus}, ${context.actorId}, ${context.correlationId}
    )
  `;
}

export interface ConfirmDraftOrderInput {
  readonly draftOrderId: string;
  readonly expectedVersion: number;
  readonly customerApproved: boolean;
  readonly approvalSource: 'customer_message' | 'dashboard' | 'internal_test';
  readonly idempotencyKey: string;
  readonly orderId: string;
  readonly orderNumber: string;
}

export async function confirmDraftOrder(
  transaction: TenantTransaction,
  context: OrderCommandContext,
  input: ConfirmDraftOrderInput,
): Promise<OrderCommandResult> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const fingerprint = commandFingerprint({
    type: 'confirm',
    draftOrderId: input.draftOrderId,
    expectedVersion: input.expectedVersion,
    customerApproved: input.customerApproved,
    approvalSource: input.approvalSource,
  });
  const replay = await replayIfPresent(transaction, context, idempotencyKey, fingerprint);
  if (replay) return replay;
  if (!input.customerApproved) {
    throw new DraftOrderValidationError('Explicit customer approval is required.');
  }

  const [draft] = await transaction<DraftOrderRow[]>`
    select
      id::text, customer_id::text as "customerId", status::text, version,
      customer_name as "customerName",
      customer_phone as "customerPhone", customer_email as "customerEmail",
      shipping_address as "shippingAddress", notes,
      custom_fields as "customFields", currency, subtotal::text,
      discount_amount::text as "discountAmount",
      shipping_amount::text as "shippingAmount", total::text
    from draft_orders
    where tenant_id = ${context.tenantId} and id = ${input.draftOrderId}
    limit 1
    for update
  `;
  if (!draft) throw new DraftOrderNotFoundError();
  if (draft.status !== 'awaiting_confirmation') {
    throw new DraftOrderStateError(draft.status);
  }
  if (draft.version !== input.expectedVersion) {
    throw new DraftOrderVersionConflictError(draft.version);
  }
  if (!draft.customerName?.trim() || !draft.customerPhone?.trim()) {
    throw new DraftOrderValidationError(
      'Customer name and phone are required before confirmation.',
    );
  }
  if (!hasCompleteAddress(draft.shippingAddress)) {
    throw new DraftOrderValidationError(
      'A complete shipping address is required before confirmation.',
    );
  }

  const items = await transaction<DraftOrderItemRow[]>`
    select
      item.id::text, item.product_id::text as "productId",
      item.variant_id::text as "variantId", item.location_id::text as "locationId",
      item.product_name_snapshot as "productNameSnapshot",
      item.product_code_snapshot as "productCodeSnapshot",
      item.variant_name_snapshot as "variantNameSnapshot",
      item.sku_snapshot as "skuSnapshot",
      item.variant_attributes_snapshot as "variantAttributesSnapshot",
      item.quantity, item.list_price::text as "listPrice",
      item.unit_price::text as "unitPrice",
      item.line_total::text as "lineTotal", item.currency,
      item.pricing_decision_id::text as "pricingDecisionId",
      coalesce(variant.price_override, product.base_price)::text as "currentListPrice",
      decision.product_id::text as "decisionProductId",
      decision.variant_id::text as "decisionVariantId",
      decision.conversation_id::text as "decisionConversationId",
      decision.currency as "decisionCurrency",
      decision.list_price::text as "decisionListPrice",
      decision.decided_price::text as "decisionDecidedPrice",
      decision.outcome::text as "decisionOutcome",
      rule_version.status::text as "pricingRuleStatus",
      (
        decision.conversation_id is null
        or exists (
          select 1 from conversations as linked_conversation
          where linked_conversation.tenant_id = item.tenant_id
            and linked_conversation.id = decision.conversation_id
            and linked_conversation.draft_order_id = item.draft_order_id
        )
      ) as "pricingConversationLinked",
      product.status::text as "productStatus",
      variant.status::text as "variantStatus"
    from draft_order_items as item
    join products as product
      on product.tenant_id = item.tenant_id and product.id = item.product_id
    join product_variants as variant
      on variant.tenant_id = item.tenant_id and variant.id = item.variant_id
    left join pricing_decisions as decision
      on decision.tenant_id = item.tenant_id
      and decision.id = item.pricing_decision_id
    left join business_rule_versions as rule_version
      on rule_version.tenant_id = decision.tenant_id
      and rule_version.rule_set_id = decision.rule_set_id
      and rule_version.id = decision.rule_version_id
    where item.tenant_id = ${context.tenantId}
      and item.draft_order_id = ${draft.id}
    order by item.created_at, item.id
  `;
  if (items.length === 0) {
    throw new DraftOrderValidationError('At least one order item is required.');
  }
  if (
    items.some(
      (item) =>
        item.productStatus !== 'active' ||
        item.variantStatus !== 'active' ||
        item.currency !== draft.currency,
    )
  ) {
    throw new DraftOrderValidationError(
      'Every item must still be active and use the draft currency.',
    );
  }
  if (items.some((item) => item.currentListPrice !== item.listPrice)) {
    throw new DraftOrderValidationError(
      'A catalog price changed; refresh the draft and request confirmation again.',
    );
  }
  if (
    items.some((item) =>
      item.pricingDecisionId
        ? item.decisionProductId !== item.productId ||
          item.decisionVariantId !== item.variantId ||
          !item.pricingConversationLinked ||
          item.decisionCurrency !== item.currency ||
          item.decisionListPrice !== item.listPrice ||
          item.decisionDecidedPrice !== item.unitPrice ||
          (item.decisionOutcome !== 'accept' && item.decisionOutcome !== 'counter') ||
          item.pricingRuleStatus !== 'published'
        : item.unitPrice !== item.listPrice,
    )
  ) {
    throw new DraftOrderValidationError(
      'A negotiated price is missing a current accepted pricing decision.',
    );
  }
  const totals = calculateQuotedOrderTotals(
    items.map((item) => ({
      listPrice: item.listPrice,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
    })),
    { shippingAmount: draft.shippingAmount },
  );
  if (
    totals.subtotal !== draft.subtotal ||
    totals.discountAmount !== draft.discountAmount ||
    totals.shippingAmount !== draft.shippingAmount ||
    totals.total !== draft.total ||
    totals.lines.some((line, index) => line.lineTotal !== items[index]?.lineTotal)
  ) {
    throw new DraftOrderValidationError('Draft totals are inconsistent; edit it again.');
  }

  await transaction`
    insert into orders (
      id, tenant_id, source_draft_order_id, customer_id, number, status, version,
      customer_name, customer_phone, customer_email, shipping_address,
      notes, custom_fields, currency, subtotal, discount_amount,
      shipping_amount, total
    ) values (
      ${input.orderId}, ${context.tenantId}, ${draft.id}, ${draft.customerId},
      ${input.orderNumber}, 'new', 1, ${draft.customerName}, ${draft.customerPhone},
      ${draft.customerEmail}, ${transaction.json(jsonInput(draft.shippingAddress))},
      ${draft.notes}, ${transaction.json(jsonInput(draft.customFields))}, ${draft.currency},
      ${draft.subtotal}, ${draft.discountAmount}, ${draft.shippingAmount}, ${draft.total}
    )
  `;

  for (const [index, item] of items.entries()) {
    const reservation = await reserveInventory(transaction, context, {
      locationId: item.locationId,
      variantId: item.variantId,
      quantity: item.quantity,
      referenceType: 'order',
      referenceId: input.orderId,
      idempotencyKey: inventoryIdempotencyKey(context, idempotencyKey, 'reserve', item.id),
      metadata: {
        orderId: input.orderId,
        draftOrderId: draft.id,
        draftOrderItemId: item.id,
      },
    });
    if (!reservation.reservation) {
      throw new Error('Order stock reservation returned no reservation.');
    }
    const calculated = totals.lines[index];
    if (!calculated) throw new Error('Calculated order line is missing.');
    await transaction`
      insert into order_items (
        tenant_id, order_id, product_id, variant_id, location_id, reservation_id,
        product_name_snapshot, product_code_snapshot, variant_name_snapshot,
        sku_snapshot, variant_attributes_snapshot, quantity, list_price,
        unit_price, line_total, currency, pricing_decision_id
      ) values (
        ${context.tenantId}, ${input.orderId}, ${item.productId}, ${item.variantId},
        ${item.locationId}, ${reservation.reservation.id}, ${item.productNameSnapshot},
        ${item.productCodeSnapshot}, ${item.variantNameSnapshot}, ${item.skuSnapshot},
        ${transaction.json(jsonInput(item.variantAttributesSnapshot))}, ${item.quantity},
        ${calculated.listPrice}, ${calculated.unitPrice}, ${calculated.lineTotal},
        ${item.currency}, ${item.pricingDecisionId}
      )
    `;
  }

  await transaction`
    update orders
    set status = 'confirmed', version = 2, confirmed_at = now(), updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${input.orderId}
  `;
  await transaction`
    update draft_orders
    set
      status = 'confirmed', customer_approved_at = now(),
      approval_source = ${input.approvalSource}, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${draft.id}
  `;
  await transaction`
    insert into order_transitions (
      tenant_id, order_id, from_status, to_status, actor_id,
      idempotency_key, correlation_id
    ) values
      (
        ${context.tenantId}, ${input.orderId}, null, 'new', ${context.actorId},
        ${`${idempotencyKey}:new`}, ${context.correlationId}
      ),
      (
        ${context.tenantId}, ${input.orderId}, 'new', 'confirmed', ${context.actorId},
        ${`${idempotencyKey}:confirmed`}, ${context.correlationId}
      )
  `;
  await insertCommand(transaction, context, {
    orderId: input.orderId,
    draftOrderId: draft.id,
    type: 'confirm',
    idempotencyKey,
    fingerprint,
    resultStatus: 'confirmed',
  });

  return {
    replayed: false,
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    status: 'confirmed',
    version: 2,
  };
}

export interface TransitionOrderInput {
  readonly orderId: string;
  readonly targetStatus: OrderStatus;
  readonly reason?: string | null | undefined;
  readonly idempotencyKey: string;
}

export async function transitionOrder(
  transaction: TenantTransaction,
  context: OrderCommandContext,
  input: TransitionOrderInput,
): Promise<OrderCommandResult> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const fingerprint = commandFingerprint({
    type: input.targetStatus === 'cancelled' ? 'cancel' : 'transition',
    orderId: input.orderId,
    targetStatus: input.targetStatus,
    reason: input.reason ?? null,
  });
  const replay = await replayIfPresent(transaction, context, idempotencyKey, fingerprint);
  if (replay) return replay;

  const [order] = await transaction<OrderRow[]>`
    select id::text, number, status::text, version
    from orders
    where tenant_id = ${context.tenantId} and id = ${input.orderId}
    limit 1
    for update
  `;
  if (!order) throw new OrderNotFoundError();
  assertOrderTransition(order.status, input.targetStatus);

  const items = await transaction<{ id: string; reservationId: string }[]>`
    select id::text, reservation_id::text as "reservationId"
    from order_items
    where tenant_id = ${context.tenantId} and order_id = ${order.id}
    order by created_at, id
  `;
  if (items.length === 0) {
    throw new DraftOrderValidationError('Order has no items.');
  }

  if (input.targetStatus === 'shipped') {
    for (const item of items) {
      await commitInventoryReservation(transaction, context, item.reservationId, {
        idempotencyKey: inventoryIdempotencyKey(context, idempotencyKey, 'commit', item.id),
      });
    }
  }
  if (input.targetStatus === 'cancelled') {
    for (const item of items) {
      await releaseInventoryReservation(transaction, context, item.reservationId, {
        idempotencyKey: inventoryIdempotencyKey(context, idempotencyKey, 'release', item.id),
        reason: input.reason ?? 'Order cancelled',
      });
    }
  }

  const [updated] = await transaction<OrderRow[]>`
    update orders
    set
      status = ${input.targetStatus}, version = version + 1, updated_at = now(),
      preparing_at = case when ${input.targetStatus} = 'preparing' then now() else preparing_at end,
      shipped_at = case when ${input.targetStatus} = 'shipped' then now() else shipped_at end,
      delivered_at = case when ${input.targetStatus} = 'delivered' then now() else delivered_at end,
      cancelled_at = case when ${input.targetStatus} = 'cancelled' then now() else cancelled_at end
    where tenant_id = ${context.tenantId} and id = ${order.id}
    returning id::text, number, status::text, version
  `;
  if (!updated) throw new OrderNotFoundError();
  await transaction`
    insert into order_transitions (
      tenant_id, order_id, from_status, to_status, actor_id,
      reason, idempotency_key, correlation_id
    ) values (
      ${context.tenantId}, ${order.id}, ${order.status}, ${input.targetStatus},
      ${context.actorId}, ${input.reason ?? null}, ${idempotencyKey},
      ${context.correlationId}
    )
  `;
  await insertCommand(transaction, context, {
    orderId: order.id,
    type: input.targetStatus === 'cancelled' ? 'cancel' : 'transition',
    idempotencyKey,
    fingerprint,
    resultStatus: input.targetStatus,
  });
  return {
    replayed: false,
    orderId: updated.id,
    orderNumber: updated.number,
    status: updated.status,
    version: updated.version,
  };
}

export { InvalidOrderTransitionError };
