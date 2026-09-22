# Draft Orders & Order Lifecycle

## Safety model

- A Draft Order is editable and separate from a confirmed Order.
- Product and variant prices are read from the catalog; callers do not supply line prices.
- Money is calculated in the Domain layer with exact integer minor-unit arithmetic.
- Editing a draft that was awaiting confirmation resets it to `draft`.
- Confirmation requires `awaiting_confirmation`, a current version, complete customer and shipping data, and explicit customer approval.
- Confirmation creates the Order, immutable item snapshots, and all stock reservations in one PostgreSQL transaction.
- Every sensitive command uses a tenant-unique idempotency key.

## Draft lifecycle

`draft → awaiting_confirmation → confirmed`

A draft can be cancelled before confirmation. Confirmed drafts are managed through their Order.

`customerId` may be supplied when a draft is created or updated. The service verifies that the customer is active in the same tenant and fills missing name, contact, and default-address fields from that profile. The confirmed order keeps `customerId` for customer history while preserving immutable name, contact, and address snapshots.

### Endpoints

- `GET /api/tenants/:tenantId/draft-orders`
- `POST /api/tenants/:tenantId/draft-orders`
- `GET /api/tenants/:tenantId/draft-orders/:draftOrderId`
- `PUT /api/tenants/:tenantId/draft-orders/:draftOrderId`
- `POST /api/tenants/:tenantId/draft-orders/:draftOrderId/submit`
- `POST /api/tenants/:tenantId/draft-orders/:draftOrderId/confirm`
- `POST /api/tenants/:tenantId/draft-orders/:draftOrderId/cancel`

### Create a draft

Customer fields may be incomplete while the conversation is collecting data. At least one item is required.

```json
{
  "customerName": "Customer One",
  "customerPhone": "+213555123456",
  "shippingAddress": {
    "line1": "10 Main Street",
    "city": "Algiers",
    "countryCode": "DZ"
  },
  "items": [
    {
      "variantId": "11111111-1111-4111-8111-111111111111",
      "locationId": "22222222-2222-4222-8222-222222222222",
      "quantity": 2
    }
  ]
}
```

The response contains catalog-derived unit prices, line totals, subtotal, and total.

### Submit for customer confirmation

```json
{
  "expectedVersion": 1
}
```

Submission fails until customer name, phone, shipping address, and items are complete. The returned version must be used by the confirmation command.

### Confirm

```json
{
  "expectedVersion": 2,
  "customerApproved": true,
  "approvalSource": "customer_message",
  "idempotencyKey": "confirm-draft-2026-0001"
}
```

`customerApproved` must literally be `true`. A stale version, missing data, inactive item, or unavailable stock rejects and rolls back the complete command. Retrying the same successful command returns the same Order and does not duplicate reservations.

## Order lifecycle

```text
new → confirmed → preparing → shipped → delivered
  └──────────────→ cancelled
           └─────→ cancelled
```

`new` is created internally during atomic confirmation; a successful confirmation returns `confirmed`. Cancellation is allowed from `new`, `confirmed`, or `preparing`. Shipping commits each active reservation to a `sell` movement. Delivered and cancelled orders are terminal.

### Endpoints

- `GET /api/tenants/:tenantId/orders`
- `GET /api/tenants/:tenantId/orders/:orderId`
- `GET /api/tenants/:tenantId/orders/by-number/:orderNumber`
- `POST /api/tenants/:tenantId/orders/:orderId/transition`
- `POST /api/tenants/:tenantId/orders/:orderId/cancel`

```json
{
  "targetStatus": "preparing",
  "idempotencyKey": "prepare-order-2026-0001"
}
```

```json
{
  "reason": "Customer changed their mind",
  "idempotencyKey": "cancel-order-2026-0001"
}
```

Invalid transitions return `409 Conflict` and create a rejected-transition audit event. Replaying a cancellation with the same key returns the cancelled Order and releases stock only once.

## Historical snapshots

Order items copy:

- Product name and display code.
- Variant name, SKU, and attributes.
- Unit price, quantity, line total, and currency.
- Inventory location and reservation.

Runtime RLS permits selecting and inserting Order Items, command records, and transitions but denies updates and deletes. A database trigger also prevents changes to confirmed Order customer, address, product total, and price snapshot fields.

## Authorization and tenant isolation

- `orders:read` controls Draft and Order reads.
- `orders:write` controls Draft edits, confirmation, transitions, and cancellation.
- PostgreSQL RLS verifies active tenant membership on every table.
- An Order command may mutate inventory only through the approved atomic command path.
