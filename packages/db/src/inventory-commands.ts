import { createHash } from 'node:crypto';
import type { TenantTransaction } from './client.js';

export type InventoryMovementKind =
  'receive' | 'adjust' | 'reserve' | 'release' | 'sell' | 'return';

export type StockReservationState = 'active' | 'released' | 'committed' | 'expired';

export interface InventoryCommandContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface InventoryReference {
  readonly referenceType?: string | null | undefined;
  readonly referenceId?: string | null | undefined;
}

export interface BalanceSnapshot {
  readonly locationId: string;
  readonly variantId: string;
  readonly onHand: number;
  readonly reserved: number;
  readonly available: number;
  readonly reorderPoint: number;
  readonly lowStock: boolean;
}

export interface ReservationSnapshot {
  readonly id: string;
  readonly locationId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly status: StockReservationState;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MovementSnapshot {
  readonly id: string;
  readonly type: InventoryMovementKind;
  readonly quantity: number;
  readonly onHandDelta: number;
  readonly reservedDelta: number;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface InventoryCommandResult {
  readonly replayed: boolean;
  readonly movement: MovementSnapshot;
  readonly balance: BalanceSnapshot;
  readonly reservation: ReservationSnapshot | null;
}

interface BalanceRow {
  locationId: string;
  variantId: string;
  onHand: number;
  reserved: number;
  reorderPoint: number;
}

interface ReservationRow {
  id: string;
  locationId: string;
  variantId: string;
  quantity: number;
  status: StockReservationState;
  referenceType: string;
  referenceId: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MovementRow {
  id: string;
  type: InventoryMovementKind;
  quantity: number;
  onHandDelta: number;
  reservedDelta: number;
  onHandAfter: number;
  reservedAfter: number;
  locationId: string;
  variantId: string;
  reservationId: string | null;
  idempotencyKey: string;
  commandFingerprint: string;
  createdAt: Date;
}

export class InventoryTargetNotFoundError extends Error {
  constructor(message = 'The inventory location or product variant was not found or is inactive.') {
    super(message);
    this.name = 'InventoryTargetNotFoundError';
  }
}

export class InventoryInsufficientStockError extends Error {
  constructor() {
    super('Insufficient available stock for this command.');
    this.name = 'InventoryInsufficientStockError';
  }
}

export class InventoryIdempotencyConflictError extends Error {
  constructor() {
    super('The idempotency key was already used for a different command.');
    this.name = 'InventoryIdempotencyConflictError';
  }
}

export class InventoryReservationStateError extends Error {
  constructor(status: StockReservationState) {
    super(`The reservation is ${status} and can no longer be changed.`);
    this.name = 'InventoryReservationStateError';
  }
}

export class InventoryCommandValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryCommandValidationError';
  }
}

function assertPositiveInteger(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new InventoryCommandValidationError('Quantity must be a positive integer.');
  }
}

function assertNonZeroInteger(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity === 0) {
    throw new InventoryCommandValidationError('Quantity delta must be a non-zero integer.');
  }
}

function normalizedKey(value: string): string {
  const key = value.trim();
  if (key.length < 8 || key.length > 128) {
    throw new InventoryCommandValidationError(
      'Idempotency key must contain between 8 and 128 characters.',
    );
  }
  return key;
}

function fingerprint(value: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function reservationSnapshot(row: ReservationRow): ReservationSnapshot {
  return {
    ...row,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function balanceSnapshot(
  row: Pick<BalanceRow, 'locationId' | 'variantId' | 'reorderPoint'> & {
    onHand: number;
    reserved: number;
  },
): BalanceSnapshot {
  const available = row.onHand - row.reserved;
  return {
    ...row,
    available,
    lowStock: available <= row.reorderPoint,
  };
}

async function acquireIdempotencyLock(
  transaction: TenantTransaction,
  tenantId: string,
  idempotencyKey: string,
): Promise<void> {
  await transaction`
    select pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:${idempotencyKey}`}, 0::bigint)
    )
  `;
}

async function loadMovementByKey(
  transaction: TenantTransaction,
  tenantId: string,
  idempotencyKey: string,
): Promise<MovementRow | null> {
  const [movement] = await transaction<MovementRow[]>`
    select
      id::text, type::text, quantity, on_hand_delta as "onHandDelta",
      reserved_delta as "reservedDelta", on_hand_after as "onHandAfter",
      reserved_after as "reservedAfter", location_id::text as "locationId",
      variant_id::text as "variantId", reservation_id::text as "reservationId",
      idempotency_key as "idempotencyKey",
      command_fingerprint as "commandFingerprint", created_at as "createdAt"
    from inventory_movements
    where tenant_id = ${tenantId} and idempotency_key = ${idempotencyKey}
    limit 1
  `;
  return movement ?? null;
}

async function loadReservation(
  transaction: TenantTransaction,
  tenantId: string,
  reservationId: string,
  forUpdate: boolean,
): Promise<ReservationRow | null> {
  const rows = forUpdate
    ? await transaction<ReservationRow[]>`
        select
          id::text, location_id::text as "locationId", variant_id::text as "variantId",
          quantity, status::text, reference_type as "referenceType",
          reference_id as "referenceId", expires_at as "expiresAt",
          created_at as "createdAt", updated_at as "updatedAt"
        from stock_reservations
        where tenant_id = ${tenantId} and id = ${reservationId}
        limit 1
        for update
      `
    : await transaction<ReservationRow[]>`
        select
          id::text, location_id::text as "locationId", variant_id::text as "variantId",
          quantity, status::text, reference_type as "referenceType",
          reference_id as "referenceId", expires_at as "expiresAt",
          created_at as "createdAt", updated_at as "updatedAt"
        from stock_reservations
        where tenant_id = ${tenantId} and id = ${reservationId}
        limit 1
      `;
  return rows[0] ?? null;
}

async function resultFromMovement(
  transaction: TenantTransaction,
  tenantId: string,
  movement: MovementRow,
  replayed: boolean,
): Promise<InventoryCommandResult> {
  const [balance] = await transaction<{ reorderPoint: number }[]>`
    select reorder_point as "reorderPoint"
    from inventory_balances
    where tenant_id = ${tenantId}
      and location_id = ${movement.locationId}
      and variant_id = ${movement.variantId}
    limit 1
  `;
  const reservation = movement.reservationId
    ? await loadReservation(transaction, tenantId, movement.reservationId, false)
    : null;

  return {
    replayed,
    movement: {
      id: movement.id,
      type: movement.type,
      quantity: movement.quantity,
      onHandDelta: movement.onHandDelta,
      reservedDelta: movement.reservedDelta,
      idempotencyKey: movement.idempotencyKey,
      createdAt: movement.createdAt.toISOString(),
    },
    balance: balanceSnapshot({
      locationId: movement.locationId,
      variantId: movement.variantId,
      onHand: movement.onHandAfter,
      reserved: movement.reservedAfter,
      reorderPoint: balance?.reorderPoint ?? 0,
    }),
    reservation: reservation ? reservationSnapshot(reservation) : null,
  };
}

async function replayIfPresent(
  transaction: TenantTransaction,
  context: InventoryCommandContext,
  idempotencyKey: string,
  commandFingerprint: string,
): Promise<InventoryCommandResult | null> {
  await acquireIdempotencyLock(transaction, context.tenantId, idempotencyKey);
  const existing = await loadMovementByKey(transaction, context.tenantId, idempotencyKey);
  if (!existing) return null;
  if (existing.commandFingerprint !== commandFingerprint) {
    throw new InventoryIdempotencyConflictError();
  }
  return resultFromMovement(transaction, context.tenantId, existing, true);
}

async function lockBalance(
  transaction: TenantTransaction,
  tenantId: string,
  locationId: string,
  variantId: string,
): Promise<BalanceRow> {
  const [target] = await transaction<{ found: boolean }[]>`
    select true as found
    from inventory_locations as location
    join product_variants as variant
      on variant.tenant_id = location.tenant_id
    where location.tenant_id = ${tenantId}
      and location.id = ${locationId}
      and location.status = 'active'
      and variant.id = ${variantId}
      and variant.status = 'active'
    limit 1
  `;
  if (!target) throw new InventoryTargetNotFoundError();

  await transaction`
    insert into inventory_balances (tenant_id, location_id, variant_id)
    values (${tenantId}, ${locationId}, ${variantId})
    on conflict (tenant_id, location_id, variant_id) do nothing
  `;
  const [balance] = await transaction<BalanceRow[]>`
    select
      location_id::text as "locationId", variant_id::text as "variantId",
      on_hand as "onHand", reserved, reorder_point as "reorderPoint"
    from inventory_balances
    where tenant_id = ${tenantId}
      and location_id = ${locationId}
      and variant_id = ${variantId}
    limit 1
    for update
  `;
  if (!balance) throw new InventoryTargetNotFoundError();
  return balance;
}

async function updateBalance(
  transaction: TenantTransaction,
  tenantId: string,
  locationId: string,
  variantId: string,
  onHand: number,
  reserved: number,
): Promise<void> {
  await transaction`
    update inventory_balances
    set on_hand = ${onHand}, reserved = ${reserved}, updated_at = now()
    where tenant_id = ${tenantId}
      and location_id = ${locationId}
      and variant_id = ${variantId}
  `;
}

interface InsertMovementInput extends InventoryReference {
  readonly context: InventoryCommandContext;
  readonly locationId: string;
  readonly variantId: string;
  readonly reservationId?: string | null;
  readonly type: InventoryMovementKind;
  readonly quantity: number;
  readonly onHandDelta: number;
  readonly reservedDelta: number;
  readonly onHandAfter: number;
  readonly reservedAfter: number;
  readonly idempotencyKey: string;
  readonly commandFingerprint: string;
  readonly reason?: string | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

type JsonInput = Parameters<TenantTransaction['json']>[0];

async function insertMovement(
  transaction: TenantTransaction,
  input: InsertMovementInput,
): Promise<MovementRow> {
  const [movement] = await transaction<MovementRow[]>`
    insert into inventory_movements (
      tenant_id, location_id, variant_id, reservation_id, type, quantity,
      on_hand_delta, reserved_delta, on_hand_after, reserved_after,
      reference_type, reference_id, idempotency_key, command_fingerprint,
      reason, actor_id, correlation_id, metadata
    ) values (
      ${input.context.tenantId}, ${input.locationId}, ${input.variantId},
      ${input.reservationId ?? null}, ${input.type}, ${input.quantity},
      ${input.onHandDelta}, ${input.reservedDelta}, ${input.onHandAfter},
      ${input.reservedAfter}, ${input.referenceType ?? null},
      ${input.referenceId ?? null}, ${input.idempotencyKey},
      ${input.commandFingerprint}, ${input.reason ?? null},
      ${input.context.actorId}, ${input.context.correlationId},
      ${transaction.json((input.metadata ?? {}) as JsonInput)}
    )
    returning
      id::text, type::text, quantity, on_hand_delta as "onHandDelta",
      reserved_delta as "reservedDelta", on_hand_after as "onHandAfter",
      reserved_after as "reservedAfter", location_id::text as "locationId",
      variant_id::text as "variantId", reservation_id::text as "reservationId",
      idempotency_key as "idempotencyKey",
      command_fingerprint as "commandFingerprint", created_at as "createdAt"
  `;
  if (!movement) throw new Error('Inventory movement insert returned no row.');
  return movement;
}

interface SimpleMovementInput extends InventoryReference {
  readonly locationId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly idempotencyKey: string;
  readonly reason?: string | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

async function applySimpleMovement(
  transaction: TenantTransaction,
  context: InventoryCommandContext,
  type: 'receive' | 'adjust' | 'sell' | 'return',
  input: SimpleMovementInput,
): Promise<InventoryCommandResult> {
  if (type === 'adjust') assertNonZeroInteger(input.quantity);
  else assertPositiveInteger(input.quantity);
  const idempotencyKey = normalizedKey(input.idempotencyKey);
  const commandFingerprint = fingerprint({
    type,
    locationId: input.locationId,
    variantId: input.variantId,
    quantity: input.quantity,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    reason: input.reason ?? null,
  });
  const replay = await replayIfPresent(transaction, context, idempotencyKey, commandFingerprint);
  if (replay) return replay;

  if (type === 'adjust' && !input.reason?.trim()) {
    throw new InventoryCommandValidationError('A reason is required for manual adjustments.');
  }
  const balance = await lockBalance(
    transaction,
    context.tenantId,
    input.locationId,
    input.variantId,
  );
  const onHandDelta =
    type === 'sell' ? -input.quantity : type === 'adjust' ? input.quantity : input.quantity;
  const onHandAfter = balance.onHand + onHandDelta;
  if (onHandAfter < balance.reserved) throw new InventoryInsufficientStockError();

  await updateBalance(
    transaction,
    context.tenantId,
    input.locationId,
    input.variantId,
    onHandAfter,
    balance.reserved,
  );
  const movement = await insertMovement(transaction, {
    ...input,
    context,
    type,
    quantity: Math.abs(input.quantity),
    onHandDelta,
    reservedDelta: 0,
    onHandAfter,
    reservedAfter: balance.reserved,
    idempotencyKey,
    commandFingerprint,
  });
  return resultFromMovement(transaction, context.tenantId, movement, false);
}

export function receiveInventory(
  transaction: TenantTransaction,
  context: InventoryCommandContext,
  input: SimpleMovementInput,
): Promise<InventoryCommandResult> {
  return applySimpleMovement(transaction, context, 'receive', input);
}

export function adjustInventory(
  transaction: TenantTransaction,
  context: InventoryCommandContext,
  input: SimpleMovementInput,
): Promise<InventoryCommandResult> {
  return applySimpleMovement(transaction, context, 'adjust', input);
}

export function sellInventory(
  transaction: TenantTransaction,
  context: InventoryCommandContext,
  input: SimpleMovementInput,
): Promise<InventoryCommandResult> {
  return applySimpleMovement(transaction, context, 'sell', input);
}

export function returnInventory(
  transaction: TenantTransaction,
  context: InventoryCommandContext,
  input: SimpleMovementInput,
): Promise<InventoryCommandResult> {
  return applySimpleMovement(transaction, context, 'return', input);
}

export interface ReserveInventoryInput {
  readonly locationId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly expiresAt?: Date | null | undefined;
  readonly idempotencyKey: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export async function reserveInventory(
  transaction: TenantTransaction,
  context: InventoryCommandContext,
  input: ReserveInventoryInput,
): Promise<InventoryCommandResult> {
  assertPositiveInteger(input.quantity);
  const idempotencyKey = normalizedKey(input.idempotencyKey);
  const commandFingerprint = fingerprint({
    type: 'reserve',
    locationId: input.locationId,
    variantId: input.variantId,
    quantity: input.quantity,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    expiresAt: input.expiresAt?.toISOString() ?? null,
  });
  const replay = await replayIfPresent(transaction, context, idempotencyKey, commandFingerprint);
  if (replay) return replay;

  const balance = await lockBalance(
    transaction,
    context.tenantId,
    input.locationId,
    input.variantId,
  );
  if (balance.onHand - balance.reserved < input.quantity) {
    throw new InventoryInsufficientStockError();
  }
  const [reservation] = await transaction<ReservationRow[]>`
    insert into stock_reservations (
      tenant_id, location_id, variant_id, quantity, status,
      reference_type, reference_id, expires_at
    ) values (
      ${context.tenantId}, ${input.locationId}, ${input.variantId}, ${input.quantity},
      'active', ${input.referenceType}, ${input.referenceId}, ${input.expiresAt ?? null}
    )
    returning
      id::text, location_id::text as "locationId", variant_id::text as "variantId",
      quantity, status::text, reference_type as "referenceType",
      reference_id as "referenceId", expires_at as "expiresAt",
      created_at as "createdAt", updated_at as "updatedAt"
  `;
  if (!reservation) throw new Error('Stock reservation insert returned no row.');

  const reservedAfter = balance.reserved + input.quantity;
  await updateBalance(
    transaction,
    context.tenantId,
    input.locationId,
    input.variantId,
    balance.onHand,
    reservedAfter,
  );
  const movement = await insertMovement(transaction, {
    context,
    locationId: input.locationId,
    variantId: input.variantId,
    reservationId: reservation.id,
    type: 'reserve',
    quantity: input.quantity,
    onHandDelta: 0,
    reservedDelta: input.quantity,
    onHandAfter: balance.onHand,
    reservedAfter,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    idempotencyKey,
    commandFingerprint,
    metadata: input.metadata,
  });
  return resultFromMovement(transaction, context.tenantId, movement, false);
}

async function transitionReservation(
  transaction: TenantTransaction,
  context: InventoryCommandContext,
  reservationId: string,
  idempotencyKeyInput: string,
  transition: 'release' | 'commit',
  reason?: string | null,
): Promise<InventoryCommandResult> {
  const idempotencyKey = normalizedKey(idempotencyKeyInput);
  const commandFingerprint = fingerprint({
    type: transition,
    reservationId,
    reason: reason ?? null,
  });
  const replay = await replayIfPresent(transaction, context, idempotencyKey, commandFingerprint);
  if (replay) return replay;

  const reservation = await loadReservation(transaction, context.tenantId, reservationId, true);
  if (!reservation) throw new InventoryTargetNotFoundError('Stock reservation not found.');
  if (reservation.status !== 'active') {
    throw new InventoryReservationStateError(reservation.status);
  }
  const balance = await lockBalance(
    transaction,
    context.tenantId,
    reservation.locationId,
    reservation.variantId,
  );
  if (balance.reserved < reservation.quantity) {
    throw new Error('Inventory balance is inconsistent with the active reservation.');
  }

  const onHandAfter =
    transition === 'commit' ? balance.onHand - reservation.quantity : balance.onHand;
  const reservedAfter = balance.reserved - reservation.quantity;
  if (onHandAfter < reservedAfter || onHandAfter < 0 || reservedAfter < 0) {
    throw new Error('Inventory balance would violate stock invariants.');
  }
  const nextStatus: StockReservationState = transition === 'commit' ? 'committed' : 'released';
  await transaction`
    update stock_reservations
    set status = ${nextStatus}, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${reservationId}
  `;
  await updateBalance(
    transaction,
    context.tenantId,
    reservation.locationId,
    reservation.variantId,
    onHandAfter,
    reservedAfter,
  );
  const movement = await insertMovement(transaction, {
    context,
    locationId: reservation.locationId,
    variantId: reservation.variantId,
    reservationId,
    type: transition === 'commit' ? 'sell' : 'release',
    quantity: reservation.quantity,
    onHandDelta: transition === 'commit' ? -reservation.quantity : 0,
    reservedDelta: -reservation.quantity,
    onHandAfter,
    reservedAfter,
    referenceType: reservation.referenceType,
    referenceId: reservation.referenceId,
    idempotencyKey,
    commandFingerprint,
    reason,
  });
  return resultFromMovement(transaction, context.tenantId, movement, false);
}

export function releaseInventoryReservation(
  transaction: TenantTransaction,
  context: InventoryCommandContext,
  reservationId: string,
  input: {
    readonly idempotencyKey: string;
    readonly reason?: string | null | undefined;
  },
): Promise<InventoryCommandResult> {
  return transitionReservation(
    transaction,
    context,
    reservationId,
    input.idempotencyKey,
    'release',
    input.reason,
  );
}

export function commitInventoryReservation(
  transaction: TenantTransaction,
  context: InventoryCommandContext,
  reservationId: string,
  input: { readonly idempotencyKey: string },
): Promise<InventoryCommandResult> {
  return transitionReservation(transaction, context, reservationId, input.idempotencyKey, 'commit');
}

export async function setInventoryReorderPoint(
  transaction: TenantTransaction,
  tenantId: string,
  locationId: string,
  variantId: string,
  reorderPoint: number,
): Promise<BalanceSnapshot> {
  if (!Number.isSafeInteger(reorderPoint) || reorderPoint < 0) {
    throw new InventoryCommandValidationError('Reorder point must be a non-negative integer.');
  }
  const balance = await lockBalance(transaction, tenantId, locationId, variantId);
  await transaction`
    update inventory_balances
    set reorder_point = ${reorderPoint}, updated_at = now()
    where tenant_id = ${tenantId}
      and location_id = ${locationId}
      and variant_id = ${variantId}
  `;
  return balanceSnapshot({ ...balance, reorderPoint });
}
