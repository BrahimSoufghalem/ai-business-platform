import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended']);
export const membershipRole = pgEnum('membership_role', ['owner', 'manager', 'agent']);
export const membershipStatus = pgEnum('membership_status', ['active', 'invited', 'disabled']);
export const productTypeStatus = pgEnum('product_type_status', ['active', 'archived']);
export const attributeDataType = pgEnum('attribute_data_type', [
  'text',
  'number',
  'boolean',
  'select',
  'multi_select',
]);
export const productStatus = pgEnum('product_status', ['draft', 'active', 'archived']);
export const productVariantStatus = pgEnum('product_variant_status', ['active', 'archived']);
export const productMediaStatus = pgEnum('product_media_status', ['pending', 'ready', 'failed']);
export const inventoryLocationStatus = pgEnum('inventory_location_status', ['active', 'archived']);
export const inventoryMovementType = pgEnum('inventory_movement_type', [
  'receive',
  'adjust',
  'reserve',
  'release',
  'sell',
  'return',
]);
export const stockReservationStatus = pgEnum('stock_reservation_status', [
  'active',
  'released',
  'committed',
  'expired',
]);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  locale: text('locale').notNull().default('ar-DZ'),
  timezone: text('timezone').notNull().default('Africa/Algiers'),
  status: tenantStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const appUsers = pgTable(
  'app_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identityProviderId: text('identity_provider_id').notNull(),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('app_users_identity_provider_id_uq').on(table.identityProviderId)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull(),
    status: membershipStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('memberships_tenant_user_uq').on(table.tenantId, table.userId),
    index('memberships_user_idx').on(table.userId),
  ],
);

export const productTypes = pgTable(
  'product_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    templateKey: text('template_key'),
    schemaVersion: integer('schema_version').notNull().default(1),
    status: productTypeStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('product_types_tenant_slug_uq').on(table.tenantId, table.slug),
    uniqueIndex('product_types_tenant_id_id_uq').on(table.tenantId, table.id),
    index('product_types_tenant_status_idx').on(table.tenantId, table.status),
  ],
);

export const attributeDefinitions = pgTable(
  'attribute_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    productTypeId: uuid('product_type_id').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    dataType: attributeDataType('data_type').notNull(),
    required: boolean('required').notNull().default(false),
    searchable: boolean('searchable').notNull().default(false),
    variantAxis: boolean('variant_axis').notNull().default(false),
    options: jsonb('options').$type<string[]>().notNull().default([]),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.productTypeId],
      foreignColumns: [productTypes.tenantId, productTypes.id],
      name: 'attribute_definitions_tenant_product_type_fk',
    }).onDelete('cascade'),
    uniqueIndex('attribute_definitions_product_type_key_uq').on(table.productTypeId, table.key),
    index('attribute_definitions_tenant_product_type_idx').on(table.tenantId, table.productTypeId),
  ],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    productTypeId: uuid('product_type_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    basePrice: numeric('base_price', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('DZD'),
    status: productStatus('status').notNull().default('draft'),
    customAttributes: jsonb('custom_attributes')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    productTypeSchemaVersion: integer('product_type_schema_version').notNull(),
    version: integer('version').notNull().default(1),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.productTypeId],
      foreignColumns: [productTypes.tenantId, productTypes.id],
      name: 'products_tenant_product_type_fk',
    }).onDelete('restrict'),
    uniqueIndex('products_tenant_code_uq').on(table.tenantId, table.code),
    uniqueIndex('products_tenant_id_id_uq').on(table.tenantId, table.id),
    index('products_tenant_status_idx').on(table.tenantId, table.status),
    index('products_tenant_type_idx').on(table.tenantId, table.productTypeId),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    productId: uuid('product_id').notNull(),
    sku: text('sku').notNull(),
    name: text('name'),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    priceOverride: numeric('price_override', { precision: 14, scale: 2 }),
    status: productVariantStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'product_variants_tenant_product_fk',
    }).onDelete('cascade'),
    uniqueIndex('product_variants_tenant_sku_uq').on(table.tenantId, table.sku),
    uniqueIndex('product_variants_tenant_id_id_uq').on(table.tenantId, table.id),
    index('product_variants_tenant_product_idx').on(table.tenantId, table.productId),
  ],
);

export const productMedia = pgTable(
  'product_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    productId: uuid('product_id').notNull(),
    objectKey: text('object_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    altText: text('alt_text'),
    sortOrder: integer('sort_order').notNull().default(0),
    status: productMediaStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'product_media_tenant_product_fk',
    }).onDelete('cascade'),
    uniqueIndex('product_media_tenant_object_key_uq').on(table.tenantId, table.objectKey),
    index('product_media_tenant_product_idx').on(table.tenantId, table.productId),
  ],
);

export const contentProductLinks = pgTable(
  'content_product_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    channel: text('channel').notNull(),
    externalContentId: text('external_content_id').notNull(),
    productId: uuid('product_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'content_product_links_tenant_product_fk',
    }).onDelete('cascade'),
    uniqueIndex('content_product_links_tenant_channel_external_uq').on(
      table.tenantId,
      table.channel,
      table.externalContentId,
    ),
    index('content_product_links_tenant_product_idx').on(table.tenantId, table.productId),
  ],
);

export const productRevisions = pgTable(
  'product_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    productId: uuid('product_id').notNull(),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    actorId: text('actor_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'product_revisions_tenant_product_fk',
    }).onDelete('cascade'),
    uniqueIndex('product_revisions_product_version_uq').on(table.productId, table.version),
    index('product_revisions_tenant_product_idx').on(table.tenantId, table.productId),
  ],
);

export const inventoryLocations = pgTable(
  'inventory_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    status: inventoryLocationStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('inventory_locations_tenant_code_uq').on(table.tenantId, table.code),
    uniqueIndex('inventory_locations_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('inventory_locations_one_default_uq')
      .on(table.tenantId)
      .where(sql`${table.isDefault} = true`),
    index('inventory_locations_tenant_status_idx').on(table.tenantId, table.status),
  ],
);

export const stockReservations = pgTable(
  'stock_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    quantity: integer('quantity').notNull(),
    status: stockReservationStatus('status').notNull().default('active'),
    referenceType: text('reference_type').notNull(),
    referenceId: text('reference_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [inventoryLocations.tenantId, inventoryLocations.id],
      name: 'stock_reservations_tenant_location_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.variantId],
      foreignColumns: [productVariants.tenantId, productVariants.id],
      name: 'stock_reservations_tenant_variant_fk',
    }).onDelete('restrict'),
    uniqueIndex('stock_reservations_tenant_id_id_uq').on(table.tenantId, table.id),
    index('stock_reservations_tenant_status_idx').on(table.tenantId, table.status),
    index('stock_reservations_tenant_reference_idx').on(
      table.tenantId,
      table.referenceType,
      table.referenceId,
    ),
    check('stock_reservations_quantity_positive', sql`${table.quantity} > 0`),
  ],
);

export const inventoryBalances = pgTable(
  'inventory_balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    onHand: integer('on_hand').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
    reorderPoint: integer('reorder_point').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [inventoryLocations.tenantId, inventoryLocations.id],
      name: 'inventory_balances_tenant_location_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.variantId],
      foreignColumns: [productVariants.tenantId, productVariants.id],
      name: 'inventory_balances_tenant_variant_fk',
    }).onDelete('restrict'),
    uniqueIndex('inventory_balances_tenant_location_variant_uq').on(
      table.tenantId,
      table.locationId,
      table.variantId,
    ),
    index('inventory_balances_tenant_variant_idx').on(table.tenantId, table.variantId),
    check('inventory_balances_on_hand_nonnegative', sql`${table.onHand} >= 0`),
    check('inventory_balances_reserved_nonnegative', sql`${table.reserved} >= 0`),
    check('inventory_balances_reserved_lte_on_hand', sql`${table.reserved} <= ${table.onHand}`),
    check('inventory_balances_reorder_point_nonnegative', sql`${table.reorderPoint} >= 0`),
  ],
);

export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    reservationId: uuid('reservation_id'),
    type: inventoryMovementType('type').notNull(),
    quantity: integer('quantity').notNull(),
    onHandDelta: integer('on_hand_delta').notNull(),
    reservedDelta: integer('reserved_delta').notNull(),
    onHandAfter: integer('on_hand_after').notNull(),
    reservedAfter: integer('reserved_after').notNull(),
    referenceType: text('reference_type'),
    referenceId: text('reference_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    commandFingerprint: text('command_fingerprint').notNull(),
    reason: text('reason'),
    actorId: text('actor_id').notNull(),
    correlationId: text('correlation_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [inventoryLocations.tenantId, inventoryLocations.id],
      name: 'inventory_movements_tenant_location_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.variantId],
      foreignColumns: [productVariants.tenantId, productVariants.id],
      name: 'inventory_movements_tenant_variant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.reservationId],
      foreignColumns: [stockReservations.tenantId, stockReservations.id],
      name: 'inventory_movements_tenant_reservation_fk',
    }).onDelete('restrict'),
    uniqueIndex('inventory_movements_tenant_idempotency_uq').on(
      table.tenantId,
      table.idempotencyKey,
    ),
    index('inventory_movements_tenant_variant_created_idx').on(
      table.tenantId,
      table.variantId,
      table.createdAt,
    ),
    index('inventory_movements_tenant_reservation_idx').on(table.tenantId, table.reservationId),
    check('inventory_movements_quantity_positive', sql`${table.quantity} > 0`),
    check('inventory_movements_on_hand_after_nonnegative', sql`${table.onHandAfter} >= 0`),
    check('inventory_movements_reserved_after_nonnegative', sql`${table.reservedAfter} >= 0`),
    check(
      'inventory_movements_reserved_after_lte_on_hand',
      sql`${table.reservedAfter} <= ${table.onHandAfter}`,
    ),
    check(
      'inventory_movements_adjust_reason_required',
      sql`${table.type} <> 'adjust' OR length(trim(coalesce(${table.reason}, ''))) > 0`,
    ),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    correlationId: text('correlation_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_tenant_created_idx').on(table.tenantId, table.createdAt),
    index('audit_events_correlation_idx').on(table.correlationId),
  ],
);
