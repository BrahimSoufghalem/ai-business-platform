# API — Foundation

All business routes use the `/api` prefix and require an OIDC Bearer access token. Health routes are public.

## Public

- `GET /api/health/live`
- `GET /api/health/ready`

## Tenants

- `GET /api/tenants` — list active memberships for the verified identity.
- `POST /api/tenants` — provision a tenant and owner membership atomically.
- `GET /api/tenants/:tenantId` — return one tenant only when RLS confirms membership.
- `GET /api/tenants/:tenantId/audit-events` — return the latest 50 audit events when the role has `audit:read`.

### Create tenant

```json
{
  "name": "Pilot Store",
  "locale": "ar-DZ",
  "timezone": "Africa/Algiers"
}
```

The authenticated OIDC `sub` becomes the first owner. Tenant ID values from the URL are only candidates: PostgreSQL RLS independently verifies an active membership before returning rows.

## Business modules

- [Dynamic Product Types](PRODUCT_TYPES_API.md)
- [Products, Variants, Media & Content Mapping](PRODUCTS_API.md)
- [Inventory Ledger, Balances & Reservations](INVENTORY_API.md)
- [Draft Orders & Order Lifecycle](ORDERS_API.md)

## Required runtime configuration

- `DATABASE_URL` — application runtime role; must not own tables or have `BYPASSRLS`.
- `AUTH_ISSUER`
- `AUTH_AUDIENCE`
- `AUTH_JWKS_URI`

Migrations should run with a separate privileged connection. Never use the migration owner as the long-running API role.
