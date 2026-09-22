import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { calculateOrderTotals, type DraftOrderStatus, type OrderStatus } from '@ai-business/domain';
import {
  DraftOrderNotFoundError,
  DraftOrderStateError,
  DraftOrderValidationError,
  DraftOrderVersionConflictError,
  InvalidOrderTransitionError,
  InventoryIdempotencyConflictError,
  InventoryInsufficientStockError,
  InventoryReservationStateError,
  InventoryTargetNotFoundError,
  OrderIdempotencyConflictError,
  OrderNotFoundError,
  confirmDraftOrder,
  transitionOrder as executeOrderTransition,
  withTenantTransaction,
  type TenantTransaction,
} from '@ai-business/db';
import { DatabaseService } from '../database/database.service.js';
import { authorizeTenantPermission } from '../tenancy/tenant-authorization.js';
import { createCandidateTenantContext } from '../tenancy/trusted-tenant-context.js';
import type {
  CancelDraftOrderInput,
  CancelOrderInput,
  ConfirmDraftOrderInput,
  CreateDraftOrderInput,
  DraftItemInput,
  DraftOrderSearchInput,
  OrderSearchInput,
  SubmitDraftOrderInput,
  TransitionOrderInput,
  UpdateDraftOrderInput,
} from './order.schemas.js';

export interface DraftOrderItemView {
  readonly id: string;
  readonly productId: string;
  readonly variantId: string;
  readonly locationId: string;
  readonly productName: string;
  readonly productCode: string;
  readonly variantName: string | null;
  readonly sku: string;
  readonly variantAttributes: Readonly<Record<string, unknown>>;
  readonly quantity: number;
  readonly unitPrice: string;
  readonly lineTotal: string;
  readonly currency: string;
}

export interface DraftOrderView {
  readonly id: string;
  readonly customerId: string | null;
  readonly status: DraftOrderStatus;
  readonly version: number;
  readonly customerName: string | null;
  readonly customerPhone: string | null;
  readonly customerEmail: string | null;
  readonly shippingAddress: Readonly<Record<string, unknown>> | null;
  readonly notes: string | null;
  readonly customFields: Readonly<Record<string, unknown>>;
  readonly currency: string;
  readonly subtotal: string;
  readonly discountAmount: string;
  readonly shippingAmount: string;
  readonly total: string;
  readonly items: readonly DraftOrderItemView[];
  readonly submittedAt: string | null;
  readonly customerApprovedAt: string | null;
  readonly approvalSource: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OrderItemView {
  readonly id: string;
  readonly productId: string;
  readonly variantId: string;
  readonly locationId: string;
  readonly reservationId: string;
  readonly productName: string;
  readonly productCode: string;
  readonly variantName: string | null;
  readonly sku: string;
  readonly variantAttributes: Readonly<Record<string, unknown>>;
  readonly quantity: number;
  readonly unitPrice: string;
  readonly lineTotal: string;
  readonly currency: string;
}

export interface OrderTransitionView {
  readonly id: string;
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus;
  readonly actorId: string;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface OrderView {
  readonly id: string;
  readonly sourceDraftOrderId: string;
  readonly customerId: string | null;
  readonly number: string;
  readonly status: OrderStatus;
  readonly version: number;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly customerEmail: string | null;
  readonly shippingAddress: Readonly<Record<string, unknown>>;
  readonly notes: string | null;
  readonly customFields: Readonly<Record<string, unknown>>;
  readonly currency: string;
  readonly subtotal: string;
  readonly discountAmount: string;
  readonly shippingAmount: string;
  readonly total: string;
  readonly items: readonly OrderItemView[];
  readonly transitions: readonly OrderTransitionView[];
  readonly confirmedAt: string | null;
  readonly preparingAt: string | null;
  readonly shippedAt: string | null;
  readonly deliveredAt: string | null;
  readonly cancelledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface QuotedDraftItem {
  readonly productId: string;
  readonly variantId: string;
  readonly locationId: string;
  readonly productName: string;
  readonly productCode: string;
  readonly variantName: string | null;
  readonly sku: string;
  readonly variantAttributes: Record<string, unknown>;
  readonly quantity: number;
  readonly unitPrice: string;
  readonly lineTotal: string;
  readonly currency: string;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

type JsonInput = Parameters<TenantTransaction['json']>[0];

function jsonInput(value: unknown): JsonInput {
  return value as JsonInput;
}

function completeAddress(address: Readonly<Record<string, unknown>> | null): boolean {
  return (
    address !== null &&
    typeof address.line1 === 'string' &&
    address.line1.trim().length > 0 &&
    typeof address.city === 'string' &&
    address.city.trim().length > 0 &&
    typeof address.countryCode === 'string' &&
    address.countryCode.length === 2
  );
}

function newOrderNumber(orderId: string): string {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `ORD-${day}-${orderId.slice(0, 8).toUpperCase()}`;
}

@Injectable()
export class OrderService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private async loadCustomerDefaults(
    transaction: TenantTransaction,
    tenantId: string,
    customerId: string,
  ): Promise<{
    readonly name: string;
    readonly phone: string | null;
    readonly email: string | null;
    readonly shippingAddress: Record<string, unknown> | null;
  }> {
    const [customer] = await transaction<{ name: string }[]>`
      select name
      from customers
      where tenant_id = ${tenantId} and id = ${customerId} and status = 'active'
      limit 1
    `;
    if (!customer) throw new NotFoundException('Active customer not found.');
    const [phone] = await transaction<{ value: string }[]>`
      select normalized_value as value
      from customer_contacts
      where tenant_id = ${tenantId} and customer_id = ${customerId}
        and type in ('phone', 'whatsapp')
      order by is_primary desc, case type when 'phone' then 0 else 1 end, created_at, id
      limit 1
    `;
    const [email] = await transaction<{ value: string }[]>`
      select normalized_value as value
      from customer_contacts
      where tenant_id = ${tenantId} and customer_id = ${customerId} and type = 'email'
      order by is_primary desc, created_at, id
      limit 1
    `;
    const [address] = await transaction<
      {
        line1: string;
        line2: string | null;
        city: string;
        region: string | null;
        postalCode: string | null;
        countryCode: string;
      }[]
    >`
      select
        line1, line2, city, region, postal_code as "postalCode",
        country_code as "countryCode"
      from customer_addresses
      where tenant_id = ${tenantId} and customer_id = ${customerId}
      order by is_default desc, created_at, id
      limit 1
    `;
    return {
      name: customer.name,
      phone: phone?.value ?? null,
      email: email?.value ?? null,
      shippingAddress: address ?? null,
    };
  }

  private translateError(error: unknown): never {
    if (
      error instanceof DraftOrderNotFoundError ||
      error instanceof OrderNotFoundError ||
      error instanceof InventoryTargetNotFoundError
    ) {
      throw new NotFoundException(error.message);
    }
    if (
      error instanceof DraftOrderStateError ||
      error instanceof DraftOrderVersionConflictError ||
      error instanceof OrderIdempotencyConflictError ||
      error instanceof InventoryIdempotencyConflictError ||
      error instanceof InventoryInsufficientStockError ||
      error instanceof InventoryReservationStateError ||
      error instanceof InvalidOrderTransitionError
    ) {
      throw new ConflictException(error.message);
    }
    if (error instanceof DraftOrderValidationError) {
      throw new BadRequestException(error.message);
    }
    if (isUniqueViolation(error)) {
      throw new ConflictException('Order number or command already exists.');
    }
    throw error;
  }

  private async recordRejectedAction(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    action: string,
    entityId: string,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    try {
      const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
      await withTenantTransaction(this.database.client, context, async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'orders:write');
        await transaction`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action, entity_type,
            entity_id, correlation_id, metadata
          ) values (
            ${context.tenantId}, 'user', ${identity.subject}, ${action},
            'order', ${entityId}, ${correlationId},
            ${transaction.json(jsonInput(metadata))}
          )
        `;
      });
    } catch {
      // Preserve the original domain rejection; database monitoring captures audit failures.
    }
  }

  private async quoteItems(
    transaction: TenantTransaction,
    tenantId: string,
    items: readonly DraftItemInput[],
  ): Promise<{
    readonly items: readonly QuotedDraftItem[];
    readonly currency: string;
    readonly subtotal: string;
    readonly discountAmount: string;
    readonly shippingAmount: string;
    readonly total: string;
  }> {
    const uniqueStockUnits = new Set<string>();
    const sourceRows: Omit<QuotedDraftItem, 'lineTotal'>[] = [];
    for (const item of items) {
      const key = `${item.locationId}:${item.variantId}`;
      if (uniqueStockUnits.has(key)) {
        throw new BadRequestException(
          'A variant and location combination may appear only once in a draft.',
        );
      }
      uniqueStockUnits.add(key);
      const [row] = await transaction<
        {
          productId: string;
          variantId: string;
          locationId: string;
          productName: string;
          productCode: string;
          variantName: string | null;
          sku: string;
          variantAttributes: Record<string, unknown>;
          unitPrice: string;
          currency: string;
        }[]
      >`
        select
          product.id::text as "productId", variant.id::text as "variantId",
          location.id::text as "locationId", product.name as "productName",
          product.code as "productCode", variant.name as "variantName",
          variant.sku, variant.attributes as "variantAttributes",
          coalesce(variant.price_override, product.base_price)::text as "unitPrice",
          product.currency
        from product_variants as variant
        join products as product
          on product.tenant_id = variant.tenant_id and product.id = variant.product_id
        join inventory_locations as location
          on location.tenant_id = variant.tenant_id and location.id = ${item.locationId}
        where variant.tenant_id = ${tenantId}
          and variant.id = ${item.variantId}
          and variant.status = 'active'
          and product.status = 'active'
          and location.status = 'active'
        limit 1
      `;
      if (!row) {
        throw new BadRequestException('An active variant and inventory location are required.');
      }
      sourceRows.push({ ...row, quantity: item.quantity });
    }
    const currency = sourceRows[0]?.currency;
    if (!currency || sourceRows.some((item) => item.currency !== currency)) {
      throw new BadRequestException('All draft items must use the same currency.');
    }
    const totals = calculateOrderTotals(
      sourceRows.map((item) => ({
        unitPrice: item.unitPrice,
        quantity: item.quantity,
      })),
    );
    return {
      items: sourceRows.map((item, index) => ({
        ...item,
        lineTotal: totals.lines[index]?.lineTotal ?? '0.00',
      })),
      currency,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      shippingAmount: totals.shippingAmount,
      total: totals.total,
    };
  }

  private async insertDraftItems(
    transaction: TenantTransaction,
    tenantId: string,
    draftOrderId: string,
    items: readonly QuotedDraftItem[],
  ): Promise<void> {
    for (const item of items) {
      await transaction`
        insert into draft_order_items (
          tenant_id, draft_order_id, product_id, variant_id, location_id,
          product_name_snapshot, product_code_snapshot, variant_name_snapshot,
          sku_snapshot, variant_attributes_snapshot, quantity, unit_price,
          line_total, currency
        ) values (
          ${tenantId}, ${draftOrderId}, ${item.productId}, ${item.variantId},
          ${item.locationId}, ${item.productName}, ${item.productCode},
          ${item.variantName}, ${item.sku},
          ${transaction.json(jsonInput(item.variantAttributes))},
          ${item.quantity}, ${item.unitPrice}, ${item.lineTotal}, ${item.currency}
        )
      `;
    }
  }

  private async loadDraft(
    transaction: TenantTransaction,
    tenantId: string,
    draftOrderId: string,
  ): Promise<DraftOrderView | null> {
    const [row] = await transaction<
      {
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
        submittedAt: Date | null;
        customerApprovedAt: Date | null;
        approvalSource: string | null;
        createdAt: Date;
        updatedAt: Date;
      }[]
    >`
      select
        id::text, customer_id::text as "customerId", status::text, version,
        customer_name as "customerName",
        customer_phone as "customerPhone", customer_email as "customerEmail",
        shipping_address as "shippingAddress", notes, custom_fields as "customFields",
        currency, subtotal::text, discount_amount::text as "discountAmount",
        shipping_amount::text as "shippingAmount", total::text,
        submitted_at as "submittedAt", customer_approved_at as "customerApprovedAt",
        approval_source as "approvalSource", created_at as "createdAt",
        updated_at as "updatedAt"
      from draft_orders
      where tenant_id = ${tenantId} and id = ${draftOrderId}
      limit 1
    `;
    if (!row) return null;
    const items = await transaction<DraftOrderItemView[]>`
      select
        id::text, product_id::text as "productId", variant_id::text as "variantId",
        location_id::text as "locationId", product_name_snapshot as "productName",
        product_code_snapshot as "productCode", variant_name_snapshot as "variantName",
        sku_snapshot as sku, variant_attributes_snapshot as "variantAttributes",
        quantity, unit_price::text as "unitPrice", line_total::text as "lineTotal",
        currency
      from draft_order_items
      where tenant_id = ${tenantId} and draft_order_id = ${draftOrderId}
      order by created_at, id
    `;
    return {
      ...row,
      items,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      customerApprovedAt: row.customerApprovedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async loadOrder(
    transaction: TenantTransaction,
    tenantId: string,
    orderId: string,
  ): Promise<OrderView | null> {
    const [row] = await transaction<
      {
        id: string;
        sourceDraftOrderId: string;
        customerId: string | null;
        number: string;
        status: OrderStatus;
        version: number;
        customerName: string;
        customerPhone: string;
        customerEmail: string | null;
        shippingAddress: Record<string, unknown>;
        notes: string | null;
        customFields: Record<string, unknown>;
        currency: string;
        subtotal: string;
        discountAmount: string;
        shippingAmount: string;
        total: string;
        confirmedAt: Date | null;
        preparingAt: Date | null;
        shippedAt: Date | null;
        deliveredAt: Date | null;
        cancelledAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
      }[]
    >`
      select
        id::text, source_draft_order_id::text as "sourceDraftOrderId",
        customer_id::text as "customerId", number, status::text, version,
        customer_name as "customerName",
        customer_phone as "customerPhone", customer_email as "customerEmail",
        shipping_address as "shippingAddress", notes, custom_fields as "customFields",
        currency, subtotal::text, discount_amount::text as "discountAmount",
        shipping_amount::text as "shippingAmount", total::text,
        confirmed_at as "confirmedAt", preparing_at as "preparingAt",
        shipped_at as "shippedAt", delivered_at as "deliveredAt",
        cancelled_at as "cancelledAt", created_at as "createdAt",
        updated_at as "updatedAt"
      from orders
      where tenant_id = ${tenantId} and id = ${orderId}
      limit 1
    `;
    if (!row) return null;
    const items = await transaction<OrderItemView[]>`
      select
        id::text, product_id::text as "productId", variant_id::text as "variantId",
        location_id::text as "locationId", reservation_id::text as "reservationId",
        product_name_snapshot as "productName", product_code_snapshot as "productCode",
        variant_name_snapshot as "variantName", sku_snapshot as sku,
        variant_attributes_snapshot as "variantAttributes", quantity,
        unit_price::text as "unitPrice", line_total::text as "lineTotal", currency
      from order_items
      where tenant_id = ${tenantId} and order_id = ${orderId}
      order by created_at, id
    `;
    const transitions = await transaction<
      (Omit<OrderTransitionView, 'createdAt'> & { createdAt: Date })[]
    >`
      select
        id::text, from_status::text as "fromStatus", to_status::text as "toStatus",
        actor_id as "actorId", reason, created_at as "createdAt"
      from order_transitions
      where tenant_id = ${tenantId} and order_id = ${orderId}
      order by created_at, id
    `;
    return {
      ...row,
      items,
      transitions: transitions.map((transition) => ({
        ...transition,
        createdAt: transition.createdAt.toISOString(),
      })),
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      preparingAt: row.preparingAt?.toISOString() ?? null,
      shippedAt: row.shippedAt?.toISOString() ?? null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async createDraft(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: CreateDraftOrderInput,
  ): Promise<DraftOrderView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'orders:write');
      const customer = input.customerId
        ? await this.loadCustomerDefaults(transaction, context.tenantId, input.customerId)
        : null;
      const quote = await this.quoteItems(transaction, context.tenantId, input.items);
      const [created] = await transaction<{ id: string }[]>`
        insert into draft_orders (
          tenant_id, customer_id, customer_name, customer_phone, customer_email,
          shipping_address, notes, custom_fields, currency, subtotal,
          discount_amount, shipping_amount, total
        ) values (
          ${context.tenantId}, ${input.customerId ?? null},
          ${input.customerName ?? customer?.name ?? null},
          ${input.customerPhone ?? customer?.phone ?? null},
          ${input.customerEmail ?? customer?.email ?? null},
          ${
            input.shippingAddress
              ? transaction.json(jsonInput(input.shippingAddress))
              : customer?.shippingAddress
                ? transaction.json(jsonInput(customer.shippingAddress))
                : null
          },
          ${input.notes ?? null}, ${transaction.json(jsonInput(input.customFields))},
          ${quote.currency}, ${quote.subtotal}, ${quote.discountAmount},
          ${quote.shippingAmount}, ${quote.total}
        )
        returning id::text
      `;
      if (!created) throw new Error('Draft order insert returned no ID.');
      await this.insertDraftItems(transaction, context.tenantId, created.id, quote.items);
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type,
          entity_id, correlation_id, metadata
        ) values (
          ${context.tenantId}, 'user', ${identity.subject}, 'draft_order.created',
          'draft_order', ${created.id}, ${correlationId},
          ${transaction.json({ itemCount: quote.items.length, total: quote.total })}
        )
      `;
      const draft = await this.loadDraft(transaction, context.tenantId, created.id);
      if (!draft) throw new Error('Created draft order could not be loaded.');
      return draft;
    });
  }

  async updateDraft(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    draftOrderId: string,
    input: UpdateDraftOrderInput,
  ): Promise<DraftOrderView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'orders:write');
      const [locked] = await transaction<{ status: DraftOrderStatus; version: number }[]>`
        select status::text, version
        from draft_orders
        where tenant_id = ${context.tenantId} and id = ${draftOrderId}
        limit 1
        for update
      `;
      if (!locked) throw new NotFoundException('Draft order not found.');
      if (locked.status === 'confirmed' || locked.status === 'cancelled') {
        throw new ConflictException(`Draft order is ${locked.status} and cannot be edited.`);
      }
      if (locked.version !== input.expectedVersion) {
        throw new ConflictException({
          message: 'Draft order changed; reload before editing.',
          currentVersion: locked.version,
        });
      }
      const current = await this.loadDraft(transaction, context.tenantId, draftOrderId);
      if (!current) throw new NotFoundException('Draft order not found.');
      const nextCustomerId = input.customerId === undefined ? current.customerId : input.customerId;
      const customerChanged =
        input.customerId !== undefined && input.customerId !== current.customerId;
      const customer =
        customerChanged && nextCustomerId
          ? await this.loadCustomerDefaults(transaction, context.tenantId, nextCustomerId)
          : null;
      const quote = input.items
        ? await this.quoteItems(transaction, context.tenantId, input.items)
        : {
            items: current.items,
            currency: current.currency,
            subtotal: current.subtotal,
            discountAmount: current.discountAmount,
            shippingAmount: current.shippingAmount,
            total: current.total,
          };
      const shippingAddress =
        input.shippingAddress === undefined
          ? customerChanged
            ? (customer?.shippingAddress ?? current.shippingAddress)
            : current.shippingAddress
          : input.shippingAddress;
      const customFields = input.customFields ?? current.customFields;
      await transaction`
        update draft_orders
        set
          status = 'draft', version = version + 1,
          customer_id = ${nextCustomerId},
          customer_name = ${
            input.customerName === undefined
              ? (customer?.name ?? current.customerName)
              : input.customerName
          },
          customer_phone = ${
            input.customerPhone === undefined
              ? (customer?.phone ?? current.customerPhone)
              : input.customerPhone
          },
          customer_email = ${
            input.customerEmail === undefined
              ? (customer?.email ?? current.customerEmail)
              : input.customerEmail
          },
          shipping_address = ${
            shippingAddress ? transaction.json(jsonInput(shippingAddress)) : null
          },
          notes = ${input.notes === undefined ? current.notes : input.notes},
          custom_fields = ${transaction.json(jsonInput(customFields))},
          currency = ${quote.currency}, subtotal = ${quote.subtotal},
          discount_amount = ${quote.discountAmount},
          shipping_amount = ${quote.shippingAmount}, total = ${quote.total},
          submitted_at = null, customer_approved_at = null,
          approval_source = null, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${draftOrderId}
      `;
      if (input.items) {
        await transaction`
          delete from draft_order_items
          where tenant_id = ${context.tenantId} and draft_order_id = ${draftOrderId}
        `;
        await this.insertDraftItems(transaction, context.tenantId, draftOrderId, quote.items);
      }
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type,
          entity_id, correlation_id, metadata
        ) values (
          ${context.tenantId}, 'user', ${identity.subject}, 'draft_order.updated',
          'draft_order', ${draftOrderId}, ${correlationId},
          ${transaction.json({
            previousVersion: current.version,
            resetConfirmation: current.status === 'awaiting_confirmation',
          })}
        )
      `;
      const updated = await this.loadDraft(transaction, context.tenantId, draftOrderId);
      if (!updated) throw new Error('Updated draft order could not be loaded.');
      return updated;
    });
  }

  async submitDraft(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    draftOrderId: string,
    input: SubmitDraftOrderInput,
  ): Promise<DraftOrderView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'orders:write');
      const [locked] = await transaction<{ status: DraftOrderStatus; version: number }[]>`
        select status::text, version
        from draft_orders
        where tenant_id = ${context.tenantId} and id = ${draftOrderId}
        limit 1
        for update
      `;
      if (!locked) throw new NotFoundException('Draft order not found.');
      if (locked.status !== 'draft') {
        throw new ConflictException(`Draft order is ${locked.status}.`);
      }
      if (locked.version !== input.expectedVersion) {
        throw new ConflictException('Draft order changed; reload before submitting.');
      }
      const draft = await this.loadDraft(transaction, context.tenantId, draftOrderId);
      if (
        !draft?.customerName ||
        !draft.customerPhone ||
        !completeAddress(draft.shippingAddress) ||
        draft.items.length === 0
      ) {
        throw new BadRequestException(
          'Customer name, phone, shipping address, and at least one item are required.',
        );
      }
      await transaction`
        update draft_orders
        set
          status = 'awaiting_confirmation', version = version + 1,
          submitted_at = now(), updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${draftOrderId}
      `;
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type,
          entity_id, correlation_id, metadata
        ) values (
          ${context.tenantId}, 'user', ${identity.subject},
          'draft_order.awaiting_confirmation', 'draft_order',
          ${draftOrderId}, ${correlationId},
          ${transaction.json({ previousVersion: draft.version, total: draft.total })}
        )
      `;
      const submitted = await this.loadDraft(transaction, context.tenantId, draftOrderId);
      if (!submitted) throw new Error('Submitted draft order could not be loaded.');
      return submitted;
    });
  }

  async cancelDraft(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    draftOrderId: string,
    input: CancelDraftOrderInput,
  ): Promise<DraftOrderView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'orders:write');
      const [locked] = await transaction<{ status: DraftOrderStatus; version: number }[]>`
        select status::text, version
        from draft_orders
        where tenant_id = ${context.tenantId} and id = ${draftOrderId}
        limit 1
        for update
      `;
      if (!locked) throw new NotFoundException('Draft order not found.');
      if (locked.status === 'confirmed') {
        throw new ConflictException('Confirmed drafts must be cancelled through their order.');
      }
      if (locked.status !== 'cancelled') {
        if (locked.version !== input.expectedVersion) {
          throw new ConflictException('Draft order changed; reload before cancelling.');
        }
        await transaction`
          update draft_orders
          set status = 'cancelled', version = version + 1, updated_at = now()
          where tenant_id = ${context.tenantId} and id = ${draftOrderId}
        `;
        await transaction`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action, entity_type,
            entity_id, correlation_id, metadata
          ) values (
            ${context.tenantId}, 'user', ${identity.subject}, 'draft_order.cancelled',
            'draft_order', ${draftOrderId}, ${correlationId},
            ${transaction.json({ reason: input.reason ?? null })}
          )
        `;
      }
      const cancelled = await this.loadDraft(transaction, context.tenantId, draftOrderId);
      if (!cancelled) throw new Error('Cancelled draft order could not be loaded.');
      return cancelled;
    });
  }

  async listDrafts(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: DraftOrderSearchInput,
  ): Promise<DraftOrderView[]> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'orders:read');
      const ids = await transaction<{ id: string }[]>`
        select id::text
        from draft_orders
        where tenant_id = ${context.tenantId}
          and (${input.status ?? null}::draft_order_status is null or status = ${input.status ?? null}::draft_order_status)
        order by updated_at desc, id
        limit ${input.limit}
      `;
      const drafts: DraftOrderView[] = [];
      for (const { id } of ids) {
        const draft = await this.loadDraft(transaction, context.tenantId, id);
        if (draft) drafts.push(draft);
      }
      return drafts;
    });
  }

  async getDraft(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    draftOrderId: string,
  ): Promise<DraftOrderView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'orders:read');
      const draft = await this.loadDraft(transaction, context.tenantId, draftOrderId);
      if (!draft) throw new NotFoundException('Draft order not found.');
      return draft;
    });
  }

  async confirmDraft(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    draftOrderId: string,
    input: ConfirmDraftOrderInput,
  ): Promise<OrderView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    try {
      return await withTenantTransaction(this.database.client, context, async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'orders:write');
        const orderId = randomUUID();
        const result = await confirmDraftOrder(
          transaction,
          {
            tenantId: context.tenantId,
            actorId: identity.subject,
            correlationId,
          },
          {
            draftOrderId,
            expectedVersion: input.expectedVersion,
            customerApproved: input.customerApproved,
            approvalSource: input.approvalSource,
            idempotencyKey: input.idempotencyKey,
            orderId,
            orderNumber: newOrderNumber(orderId),
          },
        );
        if (!result.replayed) {
          await transaction`
            insert into audit_events (
              tenant_id, actor_type, actor_id, action, entity_type,
              entity_id, correlation_id, metadata
            ) values (
              ${context.tenantId}, 'user', ${identity.subject}, 'order.confirmed',
              'order', ${result.orderId}, ${correlationId},
              ${transaction.json({
                draftOrderId,
                orderNumber: result.orderNumber,
                approvalSource: input.approvalSource,
              })}
            )
          `;
        }
        const order = await this.loadOrder(transaction, context.tenantId, result.orderId);
        if (!order) throw new Error('Confirmed order could not be loaded.');
        return order;
      });
    } catch (error) {
      if (
        error instanceof DraftOrderStateError ||
        error instanceof DraftOrderVersionConflictError ||
        error instanceof DraftOrderValidationError ||
        error instanceof InventoryInsufficientStockError
      ) {
        await this.recordRejectedAction(
          identity,
          correlationId,
          candidateTenantId,
          'order.confirm.rejected',
          draftOrderId,
          { reason: error.message },
        );
      }
      return this.translateError(error);
    }
  }

  async listOrders(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: OrderSearchInput,
  ): Promise<OrderView[]> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'orders:read');
      const pattern = `%${input.q}%`;
      const ids = await transaction<{ id: string }[]>`
        select id::text
        from orders
        where tenant_id = ${context.tenantId}
          and (${input.status ?? null}::order_status is null or status = ${input.status ?? null}::order_status)
          and (
            ${input.q} = '' or number ilike ${pattern}
            or customer_name ilike ${pattern} or customer_phone ilike ${pattern}
          )
        order by created_at desc, id
        limit ${input.limit}
      `;
      const orders: OrderView[] = [];
      for (const { id } of ids) {
        const order = await this.loadOrder(transaction, context.tenantId, id);
        if (order) orders.push(order);
      }
      return orders;
    });
  }

  async getOrder(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    orderId: string,
  ): Promise<OrderView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'orders:read');
      const order = await this.loadOrder(transaction, context.tenantId, orderId);
      if (!order) throw new NotFoundException('Order not found.');
      return order;
    });
  }

  async getOrderByNumber(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    orderNumber: string,
  ): Promise<OrderView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'orders:read');
      const [row] = await transaction<{ id: string }[]>`
        select id::text from orders
        where tenant_id = ${context.tenantId} and number = ${orderNumber.trim().toUpperCase()}
        limit 1
      `;
      if (!row) throw new NotFoundException('Order not found.');
      const order = await this.loadOrder(transaction, context.tenantId, row.id);
      if (!order) throw new NotFoundException('Order not found.');
      return order;
    });
  }

  private async runTransition(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    orderId: string,
    targetStatus: OrderStatus,
    idempotencyKey: string,
    reason?: string | null,
  ): Promise<OrderView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    try {
      return await withTenantTransaction(this.database.client, context, async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'orders:write');
        const result = await executeOrderTransition(
          transaction,
          {
            tenantId: context.tenantId,
            actorId: identity.subject,
            correlationId,
          },
          {
            orderId,
            targetStatus,
            idempotencyKey,
            reason,
          },
        );
        if (!result.replayed) {
          await transaction`
            insert into audit_events (
              tenant_id, actor_type, actor_id, action, entity_type,
              entity_id, correlation_id, metadata
            ) values (
              ${context.tenantId}, 'user', ${identity.subject},
              ${targetStatus === 'cancelled' ? 'order.cancelled' : 'order.transitioned'},
              'order', ${orderId}, ${correlationId},
              ${transaction.json({ targetStatus, reason: reason ?? null })}
            )
          `;
        }
        const order = await this.loadOrder(transaction, context.tenantId, result.orderId);
        if (!order) throw new Error('Transitioned order could not be loaded.');
        return order;
      });
    } catch (error) {
      if (error instanceof InvalidOrderTransitionError) {
        await this.recordRejectedAction(
          identity,
          correlationId,
          candidateTenantId,
          'order.transition.rejected',
          orderId,
          { fromStatus: error.from, targetStatus: error.to, reason: error.message },
        );
      }
      return this.translateError(error);
    }
  }

  transition(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    orderId: string,
    input: TransitionOrderInput,
  ): Promise<OrderView> {
    return this.runTransition(
      identity,
      correlationId,
      candidateTenantId,
      orderId,
      input.targetStatus,
      input.idempotencyKey,
      input.reason,
    );
  }

  cancelOrder(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    orderId: string,
    input: CancelOrderInput,
  ): Promise<OrderView> {
    return this.runTransition(
      identity,
      correlationId,
      candidateTenantId,
      orderId,
      'cancelled',
      input.idempotencyKey,
      input.reason,
    );
  }
}
