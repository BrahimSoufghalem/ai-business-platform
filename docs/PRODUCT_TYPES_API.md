# Product Types & Custom Attributes API

Product types are tenant-owned schemas. Adding a new type or attribute does not require a database migration. The platform stores definitions in `product_types` and `attribute_definitions`; future product values are validated against the selected schema version.

## Templates

`GET /api/product-type-templates` returns starter schemas for General Product, Clothing, Shoes, Smartphone, Laptop, and Headset. Templates are copied at creation time and remain fully editable.

## Tenant endpoints

- `GET /api/tenants/:tenantId/product-types`
- `POST /api/tenants/:tenantId/product-types`
- `GET /api/tenants/:tenantId/product-types/:productTypeId`
- `PUT /api/tenants/:tenantId/product-types/:productTypeId`
- `DELETE /api/tenants/:tenantId/product-types/:productTypeId` — archives; it does not hard-delete.

Create example:

```json
{
  "name": "Smartphones",
  "slug": "smartphones",
  "templateKey": "smartphone"
}
```

Custom example:

```json
{
  "name": "Auto Parts",
  "slug": "auto-parts",
  "attributes": [
    {
      "key": "compatible_models",
      "label": "Compatible models",
      "dataType": "multi_select",
      "searchable": true,
      "options": ["Clio 4", "208", "Golf 7"]
    }
  ]
}
```

Updates require `expectedSchemaVersion`. A stale version returns `409 Conflict`, preventing one editor from silently overwriting another. Attribute keys are normalized to lowercase snake_case and may not be duplicated. A type supports at most 50 attributes and 3 variant axes.

## Authorization

- `owner` and `manager`: catalog read/write.
- `agent`: catalog read only.
- PostgreSQL RLS additionally enforces active tenant membership.
