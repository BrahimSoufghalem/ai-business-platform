# Inventory Ledger, Balances & Reservations

## Invariants

- A product variant is the stock unit.
- Stock is scoped by tenant and inventory location.
- `available = on_hand - reserved`.
- `on_hand >= 0`, `reserved >= 0`, and `reserved <= on_hand`.
- Every stock change appends one immutable movement and updates its balance inside the same transaction.
- Every command accepts a tenant-unique `idempotencyKey`. Retrying the same payload returns the original movement; reusing the key with a different payload returns `409 Conflict`.
- Manual adjustments require a reason.

PostgreSQL row locks serialize commands for the same location and variant. Two requests cannot reserve or sell the final unit twice.

## Locations

- `GET /api/tenants/:tenantId/inventory/locations`
- `POST /api/tenants/:tenantId/inventory/locations`

```json
{
  "code": "MAIN",
  "name": "Main warehouse",
  "isDefault": true
}
```

The first location becomes the default automatically. Setting a later location as default clears the previous default in the same transaction.

## Balances and low-stock alerts

- `GET /api/tenants/:tenantId/inventory/balances`
- `GET /api/tenants/:tenantId/inventory/balances?locationId=...&variantId=...&lowStock=true`
- `PUT /api/tenants/:tenantId/inventory/balances/reorder-point`

```json
{
  "locationId": "11111111-1111-4111-8111-111111111111",
  "variantId": "22222222-2222-4222-8222-222222222222",
  "reorderPoint": 5
}
```

A balance is low when its available quantity is less than or equal to its reorder point.

## Stock commands

- `POST /api/tenants/:tenantId/inventory/receive`
- `POST /api/tenants/:tenantId/inventory/adjust`
- `POST /api/tenants/:tenantId/inventory/sales`
- `POST /api/tenants/:tenantId/inventory/returns`

Receive, sell, and return accept a positive integer `quantity`. Adjustment accepts a signed, non-zero `quantityDelta`.

```json
{
  "locationId": "11111111-1111-4111-8111-111111111111",
  "variantId": "22222222-2222-4222-8222-222222222222",
  "quantity": 10,
  "referenceType": "purchase_order",
  "referenceId": "PO-2026-001",
  "idempotencyKey": "receive-PO-2026-001"
}
```

```json
{
  "locationId": "11111111-1111-4111-8111-111111111111",
  "variantId": "22222222-2222-4222-8222-222222222222",
  "quantityDelta": -1,
  "reason": "Damaged during cycle count",
  "idempotencyKey": "adjust-count-2026-09-22-variant-2222"
}
```

`referenceType` and `referenceId` are optional but must be supplied together. Orders can later use these fields without coupling inventory to the Orders module.

## Reservations

- `GET /api/tenants/:tenantId/inventory/reservations`
- `POST /api/tenants/:tenantId/inventory/reservations`
- `POST /api/tenants/:tenantId/inventory/reservations/:reservationId/release`
- `POST /api/tenants/:tenantId/inventory/reservations/:reservationId/commit`

```json
{
  "locationId": "11111111-1111-4111-8111-111111111111",
  "variantId": "22222222-2222-4222-8222-222222222222",
  "quantity": 1,
  "referenceType": "draft_order",
  "referenceId": "draft-123",
  "expiresAt": "2026-09-22T20:00:00+01:00",
  "idempotencyKey": "reserve-draft-123-line-1"
}
```

Releasing changes only `reserved`. Committing a reservation changes both `on_hand` and `reserved` once and appends a `sell` movement. A reservation can transition from `active` only once.

## Ledger

- `GET /api/tenants/:tenantId/inventory/movements`
- Optional filters: `locationId`, `variantId`, `type`, and `limit`.

Each movement records quantity, on-hand and reserved deltas, resulting balances, actor, correlation ID, references, and the idempotency key. Runtime RLS permits selecting and inserting movements but denies updates and deletes.

## Authorization and audit

- Owners and managers: `inventory:read` and `inventory:write`.
- Agents: `inventory:read`.
- Every non-replayed write creates an audit event. Idempotent retries do not duplicate the movement or audit event.
