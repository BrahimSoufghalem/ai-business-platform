# Products, Variants, Media & Content Mapping

## Product model

Every product uses a tenant-owned Product Type and records the schema version used for validation. Shared fields remain relational; configurable values live in `custom_attributes`. Variant-axis values live on variants, not on the product.

Products use immutable IDs, a tenant-unique display code, optimistic `version`, and lifecycle states: `draft`, `active`, `archived`. Every catalog write also stores an immutable JSON revision so later changes cannot overwrite historical product state.

## Product endpoints

- `GET /api/tenants/:tenantId/products?q=&status=&productTypeId=&limit=`
- `POST /api/tenants/:tenantId/products`
- `GET /api/tenants/:tenantId/products/by-code/:code`
- `GET /api/tenants/:tenantId/products/:productId`
- `PUT /api/tenants/:tenantId/products/:productId`
- `POST /api/tenants/:tenantId/products/:productId/publish`
- `DELETE /api/tenants/:tenantId/products/:productId` — archives only.

A draft may be incomplete. Publishing revalidates all required product attributes, requires at least one variant, and validates every variant axis. Product codes and SKUs are normalized to uppercase and are unique inside a tenant. Updates require `expectedVersion`.

## Media flow

1. `POST /api/tenants/:tenantId/products/:productId/media/upload-ticket`
2. Upload the image directly to the returned S3-compatible signed URL using the exact content type.
3. `POST /api/tenants/:tenantId/products/:productId/media/:mediaId/complete`
4. `GET /api/tenants/:tenantId/products/:productId/media/:mediaId/download`

Only JPEG, PNG, WebP, and GIF are accepted initially. Object keys are tenant- and product-prefixed. The API stores object keys, never public URLs.

Required media configuration:

- `S3_ENDPOINT` — optional for AWS S3, required for compatible providers.
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE`

## Instagram content mapping

- `PUT /api/tenants/:tenantId/content-links`
- `GET /api/tenants/:tenantId/content-links/resolve?channel=instagram&externalContentId=...`

The unique mapping key is `(tenant, channel, externalContentId)`. The same Reel ID can never resolve a product from another tenant or another channel. Product Code search remains the MVP fallback when platform context is unavailable.
