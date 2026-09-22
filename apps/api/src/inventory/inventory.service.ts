import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import {
  InventoryCommandValidationError,
  InventoryIdempotencyConflictError,
  InventoryInsufficientStockError,
  InventoryReservationStateError,
  InventoryTargetNotFoundError,
  adjustInventory,
  commitInventoryReservation,
  receiveInventory,
  releaseInventoryReservation,
  reserveInventory,
  returnInventory,
  sellInventory,
  setInventoryReorderPoint,
  withTenantTransaction,
  type InventoryCommandResult,
  type TenantTransaction,
} from '@ai-business/db';
import { DatabaseService } from '../database/database.service.js';
import { authorizeTenantPermission } from '../tenancy/tenant-authorization.js';
import { createCandidateTenantContext } from '../tenancy/trusted-tenant-context.js';
import type {
  AdjustInventoryInput,
  BalanceQueryInput,
  CommitReservationInput,
  CreateInventoryLocationInput,
  MovementQueryInput,
  ReceiveInventoryInput,
  ReleaseReservationInput,
  ReservationQueryInput,
  ReserveInventoryInput,
  ReturnInventoryInput,
  SellInventoryInput,
  SetReorderPointInput,
} from './inventory.schemas.js';

export interface InventoryLocationView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly status: 'active' | 'archived';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InventoryBalanceView {
  readonly locationId: string;
  readonly locationCode: string;
  readonly locationName: string;
  readonly variantId: string;
  readonly sku: string;
  readonly variantName: string | null;
  readonly productId: string;
  readonly productCode: string;
  readonly productName: string;
  readonly onHand: number;
  readonly reserved: number;
  readonly available: number;
  readonly reorderPoint: number;
  readonly lowStock: boolean;
  readonly updatedAt: string;
}

export interface InventoryMovementView {
  readonly id: string;
  readonly locationId: string;
  readonly variantId: string;
  readonly reservationId: string | null;
  readonly type: 'receive' | 'adjust' | 'reserve' | 'release' | 'sell' | 'return';
  readonly quantity: number;
  readonly onHandDelta: number;
  readonly reservedDelta: number;
  readonly onHandAfter: number;
  readonly reservedAfter: number;
  readonly referenceType: string | null;
  readonly referenceId: string | null;
  readonly reason: string | null;
  readonly actorId: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface StockReservationView {
  readonly id: string;
  readonly locationId: string;
  readonly variantId: string;
  readonly sku: string;
  readonly quantity: number;
  readonly status: 'active' | 'released' | 'committed' | 'expired';
  readonly referenceType: string;
  readonly referenceId: string;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

type JsonInput = Parameters<TenantTransaction['json']>[0];

@Injectable()
export class InventoryService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private translateInventoryError(error: unknown): never {
    if (error instanceof InventoryTargetNotFoundError) {
      throw new NotFoundException(error.message);
    }
    if (
      error instanceof InventoryInsufficientStockError ||
      error instanceof InventoryIdempotencyConflictError ||
      error instanceof InventoryReservationStateError
    ) {
      throw new ConflictException(error.message);
    }
    if (error instanceof InventoryCommandValidationError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }

  private async auditCommand(
    transaction: TenantTransaction,
    identity: VerifiedIdentity,
    tenantId: string,
    correlationId: string,
    action: string,
    result: InventoryCommandResult,
  ): Promise<void> {
    if (result.replayed) return;
    await transaction`
      insert into audit_events (
        tenant_id, actor_type, actor_id, action, entity_type, entity_id,
        correlation_id, metadata
      ) values (
        ${tenantId}, 'user', ${identity.subject}, ${action},
        'inventory_movement', ${result.movement.id}, ${correlationId},
        ${transaction.json({
          locationId: result.balance.locationId,
          variantId: result.balance.variantId,
          reservationId: result.reservation?.id ?? null,
          quantity: result.movement.quantity,
          onHandAfter: result.balance.onHand,
          reservedAfter: result.balance.reserved,
        } as JsonInput)}
      )
    `;
  }

  private async runCommand(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    action: string,
    operation: (
      transaction: TenantTransaction,
      commandContext: { tenantId: string; actorId: string; correlationId: string },
    ) => Promise<InventoryCommandResult>,
  ): Promise<InventoryCommandResult> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    try {
      return await withTenantTransaction(this.database.client, context, async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'inventory:write');
        const result = await operation(transaction, {
          tenantId: context.tenantId,
          actorId: identity.subject,
          correlationId,
        });
        await this.auditCommand(
          transaction,
          identity,
          context.tenantId,
          correlationId,
          action,
          result,
        );
        return result;
      });
    } catch (error) {
      return this.translateInventoryError(error);
    }
  }

  async createLocation(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: CreateInventoryLocationInput,
  ): Promise<InventoryLocationView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    try {
      return await withTenantTransaction(this.database.client, context, async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'inventory:write');
        await transaction`
          select pg_advisory_xact_lock(
            hashtextextended(${`${context.tenantId}:inventory-locations`}, 0::bigint)
          )
        `;
        const [summary] = await transaction<{ activeCount: number }[]>`
          select count(*)::int as "activeCount"
          from inventory_locations
          where tenant_id = ${context.tenantId} and status = 'active'
        `;
        const isDefault = input.isDefault || (summary?.activeCount ?? 0) === 0;
        if (isDefault) {
          await transaction`
            update inventory_locations
            set is_default = false, updated_at = now()
            where tenant_id = ${context.tenantId} and is_default = true
          `;
        }
        const [created] = await transaction<
          {
            id: string;
            code: string;
            name: string;
            isDefault: boolean;
            status: 'active' | 'archived';
            createdAt: Date;
            updatedAt: Date;
          }[]
        >`
          insert into inventory_locations (tenant_id, code, name, is_default)
          values (${context.tenantId}, ${input.code}, ${input.name}, ${isDefault})
          returning
            id::text, code, name, is_default as "isDefault", status::text,
            created_at as "createdAt", updated_at as "updatedAt"
        `;
        if (!created) throw new Error('Inventory location insert returned no row.');
        await transaction`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action, entity_type, entity_id,
            correlation_id, metadata
          ) values (
            ${context.tenantId}, 'user', ${identity.subject}, 'inventory.location.created',
            'inventory_location', ${created.id}, ${correlationId},
            ${transaction.json({ code: created.code, isDefault: created.isDefault })}
          )
        `;
        return {
          ...created,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Inventory location code already exists.');
      }
      throw error;
    }
  }

  async listLocations(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
  ): Promise<InventoryLocationView[]> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'inventory:read');
      const rows = await transaction<
        {
          id: string;
          code: string;
          name: string;
          isDefault: boolean;
          status: 'active' | 'archived';
          createdAt: Date;
          updatedAt: Date;
        }[]
      >`
        select
          id::text, code, name, is_default as "isDefault", status::text,
          created_at as "createdAt", updated_at as "updatedAt"
        from inventory_locations
        where tenant_id = ${context.tenantId}
        order by is_default desc, name, id
      `;
      return rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
    });
  }

  async listBalances(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: BalanceQueryInput,
  ): Promise<InventoryBalanceView[]> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'inventory:read');
      const rows = await transaction<
        (Omit<InventoryBalanceView, 'lowStock' | 'updatedAt'> & { updatedAt: Date })[]
      >`
        select
          balance.location_id::text as "locationId",
          location.code as "locationCode", location.name as "locationName",
          balance.variant_id::text as "variantId", variant.sku,
          variant.name as "variantName", variant.product_id::text as "productId",
          product.code as "productCode", product.name as "productName",
          balance.on_hand as "onHand", balance.reserved,
          balance.on_hand - balance.reserved as available,
          balance.reorder_point as "reorderPoint", balance.updated_at as "updatedAt"
        from inventory_balances as balance
        join inventory_locations as location
          on location.tenant_id = balance.tenant_id and location.id = balance.location_id
        join product_variants as variant
          on variant.tenant_id = balance.tenant_id and variant.id = balance.variant_id
        join products as product
          on product.tenant_id = variant.tenant_id and product.id = variant.product_id
        where balance.tenant_id = ${context.tenantId}
          and (${input.locationId ?? null}::uuid is null or balance.location_id = ${input.locationId ?? null}::uuid)
          and (${input.variantId ?? null}::uuid is null or balance.variant_id = ${input.variantId ?? null}::uuid)
          and (
            ${input.lowStock ?? null}::boolean is null
            or ((balance.on_hand - balance.reserved) <= balance.reorder_point) = ${input.lowStock ?? null}::boolean
          )
        order by
          ((balance.on_hand - balance.reserved) <= balance.reorder_point) desc,
          product.name, variant.sku, location.name
        limit ${input.limit}
      `;
      return rows.map((row) => ({
        ...row,
        lowStock: row.available <= row.reorderPoint,
        updatedAt: row.updatedAt.toISOString(),
      }));
    });
  }

  async setReorderPoint(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: SetReorderPointInput,
  ) {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    try {
      return await withTenantTransaction(this.database.client, context, async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'inventory:write');
        const balance = await setInventoryReorderPoint(
          transaction,
          context.tenantId,
          input.locationId,
          input.variantId,
          input.reorderPoint,
        );
        await transaction`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action, entity_type, entity_id,
            correlation_id, metadata
          ) values (
            ${context.tenantId}, 'user', ${identity.subject},
            'inventory.reorder_point.updated', 'product_variant', ${input.variantId},
            ${correlationId},
            ${transaction.json({
              locationId: input.locationId,
              reorderPoint: input.reorderPoint,
            })}
          )
        `;
        return balance;
      });
    } catch (error) {
      return this.translateInventoryError(error);
    }
  }

  async listMovements(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: MovementQueryInput,
  ): Promise<InventoryMovementView[]> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'inventory:read');
      const rows = await transaction<
        (Omit<InventoryMovementView, 'createdAt'> & { createdAt: Date })[]
      >`
        select
          id::text, location_id::text as "locationId", variant_id::text as "variantId",
          reservation_id::text as "reservationId", type::text, quantity,
          on_hand_delta as "onHandDelta", reserved_delta as "reservedDelta",
          on_hand_after as "onHandAfter", reserved_after as "reservedAfter",
          reference_type as "referenceType", reference_id as "referenceId",
          reason, actor_id as "actorId", correlation_id as "correlationId",
          created_at as "createdAt"
        from inventory_movements
        where tenant_id = ${context.tenantId}
          and (${input.locationId ?? null}::uuid is null or location_id = ${input.locationId ?? null}::uuid)
          and (${input.variantId ?? null}::uuid is null or variant_id = ${input.variantId ?? null}::uuid)
          and (${input.type ?? null}::inventory_movement_type is null or type = ${input.type ?? null}::inventory_movement_type)
        order by created_at desc, id desc
        limit ${input.limit}
      `;
      return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
    });
  }

  async listReservations(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: ReservationQueryInput,
  ): Promise<StockReservationView[]> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'inventory:read');
      const rows = await transaction<
        (Omit<StockReservationView, 'expiresAt' | 'createdAt' | 'updatedAt'> & {
          expiresAt: Date | null;
          createdAt: Date;
          updatedAt: Date;
        })[]
      >`
        select
          reservation.id::text, reservation.location_id::text as "locationId",
          reservation.variant_id::text as "variantId", variant.sku,
          reservation.quantity, reservation.status::text,
          reservation.reference_type as "referenceType",
          reservation.reference_id as "referenceId",
          reservation.expires_at as "expiresAt",
          reservation.created_at as "createdAt", reservation.updated_at as "updatedAt"
        from stock_reservations as reservation
        join product_variants as variant
          on variant.tenant_id = reservation.tenant_id
         and variant.id = reservation.variant_id
        where reservation.tenant_id = ${context.tenantId}
          and (${input.status ?? null}::stock_reservation_status is null or reservation.status = ${input.status ?? null}::stock_reservation_status)
          and (${input.referenceType ?? null}::text is null or reservation.reference_type = ${input.referenceType ?? null})
          and (${input.referenceId ?? null}::text is null or reservation.reference_id = ${input.referenceId ?? null})
        order by reservation.created_at desc, reservation.id desc
        limit ${input.limit}
      `;
      return rows.map((row) => ({
        ...row,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
    });
  }

  receive(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: ReceiveInventoryInput,
  ) {
    return this.runCommand(
      identity,
      correlationId,
      candidateTenantId,
      'inventory.received',
      (transaction, context) => receiveInventory(transaction, context, input),
    );
  }

  adjust(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: AdjustInventoryInput,
  ) {
    return this.runCommand(
      identity,
      correlationId,
      candidateTenantId,
      'inventory.adjusted',
      (transaction, context) =>
        adjustInventory(transaction, context, {
          locationId: input.locationId,
          variantId: input.variantId,
          quantity: input.quantityDelta,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
        }),
    );
  }

  sell(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: SellInventoryInput,
  ) {
    return this.runCommand(
      identity,
      correlationId,
      candidateTenantId,
      'inventory.sold',
      (transaction, context) => sellInventory(transaction, context, input),
    );
  }

  returnStock(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: ReturnInventoryInput,
  ) {
    return this.runCommand(
      identity,
      correlationId,
      candidateTenantId,
      'inventory.returned',
      (transaction, context) => returnInventory(transaction, context, input),
    );
  }

  reserve(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: ReserveInventoryInput,
  ) {
    return this.runCommand(
      identity,
      correlationId,
      candidateTenantId,
      'inventory.reserved',
      (transaction, context) => reserveInventory(transaction, context, input),
    );
  }

  release(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    reservationId: string,
    input: ReleaseReservationInput,
  ) {
    return this.runCommand(
      identity,
      correlationId,
      candidateTenantId,
      'inventory.reservation.released',
      (transaction, context) =>
        releaseInventoryReservation(transaction, context, reservationId, input),
    );
  }

  commit(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    reservationId: string,
    input: CommitReservationInput,
  ) {
    return this.runCommand(
      identity,
      correlationId,
      candidateTenantId,
      'inventory.reservation.committed',
      (transaction, context) =>
        commitInventoryReservation(transaction, context, reservationId, input),
    );
  }
}
