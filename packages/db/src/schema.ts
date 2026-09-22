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
export const draftOrderStatus = pgEnum('draft_order_status', [
  'draft',
  'awaiting_confirmation',
  'confirmed',
  'cancelled',
]);
export const orderStatus = pgEnum('order_status', [
  'new',
  'confirmed',
  'preparing',
  'shipped',
  'delivered',
  'cancelled',
]);
export const orderCommandType = pgEnum('order_command_type', ['confirm', 'transition', 'cancel']);
export const customerStatus = pgEnum('customer_status', ['active', 'archived']);
export const customerContactType = pgEnum('customer_contact_type', [
  'phone',
  'email',
  'whatsapp',
  'instagram',
]);
export const conversationChannel = pgEnum('conversation_channel', [
  'internal',
  'instagram',
  'whatsapp',
  'web',
  'email',
]);
export const conversationStatus = pgEnum('conversation_status', [
  'bot',
  'needs_human',
  'human',
  'closed',
]);
export const messageDirection = pgEnum('message_direction', ['inbound', 'outbound', 'internal']);
export const messageSenderType = pgEnum('message_sender_type', [
  'customer',
  'agent',
  'bot',
  'system',
]);
export const configurationVersionStatus = pgEnum('configuration_version_status', [
  'draft',
  'published',
  'superseded',
]);
export const knowledgeEntryKind = pgEnum('knowledge_entry_kind', ['faq', 'article', 'policy']);
export const agentTone = pgEnum('agent_tone', ['professional', 'friendly', 'concise', 'warm']);
export const priceDecisionOutcome = pgEnum('price_decision_outcome', [
  'accept',
  'counter',
  'handoff',
  'reject',
]);
export const aiTask = pgEnum('ai_task', ['classify', 'compose', 'negotiate', 'summarize']);
export const aiIntent = pgEnum('ai_intent', [
  'faq',
  'product_discovery',
  'pricing',
  'order_draft',
  'order_confirmation',
  'order_status',
  'handoff',
  'summary',
]);
export const aiRunOutcome = pgEnum('ai_run_outcome', ['completed', 'handoff']);
export const aiToolKind = pgEnum('ai_tool_kind', ['read', 'command']);
export const aiToolCallStatus = pgEnum('ai_tool_call_status', ['succeeded', 'rejected', 'failed']);

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

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: customerStatus('status').notNull().default('active'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('customers_tenant_id_id_uq').on(table.tenantId, table.id),
    index('customers_tenant_name_idx').on(table.tenantId, table.name),
    check('customers_name_not_blank', sql`length(trim(${table.name})) > 0`),
    check('customers_version_positive', sql`${table.version} > 0`),
  ],
);

export const customerContacts = pgTable(
  'customer_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    type: customerContactType('type').notNull(),
    value: text('value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    label: text('label'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'customer_contacts_tenant_customer_fk',
    }).onDelete('cascade'),
    uniqueIndex('customer_contacts_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('customer_contacts_tenant_normalized_uq').on(table.tenantId, table.normalizedValue),
    index('customer_contacts_tenant_customer_idx').on(table.tenantId, table.customerId),
    check('customer_contacts_value_not_blank', sql`length(trim(${table.value})) > 0`),
    check(
      'customer_contacts_normalized_not_blank',
      sql`length(trim(${table.normalizedValue})) > 0`,
    ),
  ],
);

export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    label: text('label'),
    recipientName: text('recipient_name'),
    line1: text('line1').notNull(),
    line2: text('line2'),
    city: text('city').notNull(),
    region: text('region'),
    postalCode: text('postal_code'),
    countryCode: text('country_code').notNull().default('DZ'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'customer_addresses_tenant_customer_fk',
    }).onDelete('cascade'),
    uniqueIndex('customer_addresses_tenant_id_id_uq').on(table.tenantId, table.id),
    index('customer_addresses_tenant_customer_idx').on(table.tenantId, table.customerId),
    check('customer_addresses_line1_not_blank', sql`length(trim(${table.line1})) > 0`),
    check('customer_addresses_city_not_blank', sql`length(trim(${table.city})) > 0`),
    check('customer_addresses_country_code_length', sql`length(trim(${table.countryCode})) = 2`),
  ],
);

export const customerNotes = pgTable(
  'customer_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    body: text('body').notNull(),
    authorId: text('author_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'customer_notes_tenant_customer_fk',
    }).onDelete('cascade'),
    uniqueIndex('customer_notes_tenant_id_id_uq').on(table.tenantId, table.id),
    index('customer_notes_tenant_customer_created_idx').on(
      table.tenantId,
      table.customerId,
      table.createdAt,
    ),
    check('customer_notes_body_not_blank', sql`length(trim(${table.body})) > 0`),
  ],
);

export const draftOrders = pgTable(
  'draft_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id'),
    status: draftOrderStatus('status').notNull().default('draft'),
    version: integer('version').notNull().default(1),
    customerName: text('customer_name'),
    customerPhone: text('customer_phone'),
    customerEmail: text('customer_email'),
    shippingAddress: jsonb('shipping_address').$type<Record<string, unknown>>(),
    notes: text('notes'),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    currency: text('currency').notNull().default('DZD'),
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
    discountAmount: numeric('discount_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    shippingAmount: numeric('shipping_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 14, scale: 2 }).notNull().default('0'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    customerApprovedAt: timestamp('customer_approved_at', { withTimezone: true }),
    approvalSource: text('approval_source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'draft_orders_tenant_customer_fk',
    }).onDelete('restrict'),
    uniqueIndex('draft_orders_tenant_id_id_uq').on(table.tenantId, table.id),
    index('draft_orders_tenant_status_idx').on(table.tenantId, table.status),
    index('draft_orders_tenant_customer_created_idx').on(
      table.tenantId,
      table.customerId,
      table.createdAt,
    ),
    check('draft_orders_version_positive', sql`${table.version} > 0`),
    check('draft_orders_subtotal_nonnegative', sql`${table.subtotal} >= 0`),
    check('draft_orders_discount_nonnegative', sql`${table.discountAmount} >= 0`),
    check('draft_orders_shipping_nonnegative', sql`${table.shippingAmount} >= 0`),
    check('draft_orders_total_nonnegative', sql`${table.total} >= 0`),
    check(
      'draft_orders_total_consistent',
      sql`${table.total} = ${table.subtotal} - ${table.discountAmount} + ${table.shippingAmount}`,
    ),
  ],
);

export const draftOrderItems = pgTable(
  'draft_order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    draftOrderId: uuid('draft_order_id').notNull(),
    productId: uuid('product_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    productNameSnapshot: text('product_name_snapshot').notNull(),
    productCodeSnapshot: text('product_code_snapshot').notNull(),
    variantNameSnapshot: text('variant_name_snapshot'),
    skuSnapshot: text('sku_snapshot').notNull(),
    variantAttributesSnapshot: jsonb('variant_attributes_snapshot')
      .$type<Record<string, unknown>>()
      .notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
    lineTotal: numeric('line_total', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.draftOrderId],
      foreignColumns: [draftOrders.tenantId, draftOrders.id],
      name: 'draft_order_items_tenant_draft_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'draft_order_items_tenant_product_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.variantId],
      foreignColumns: [productVariants.tenantId, productVariants.id],
      name: 'draft_order_items_tenant_variant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [inventoryLocations.tenantId, inventoryLocations.id],
      name: 'draft_order_items_tenant_location_fk',
    }).onDelete('restrict'),
    uniqueIndex('draft_order_items_draft_variant_location_uq').on(
      table.draftOrderId,
      table.variantId,
      table.locationId,
    ),
    index('draft_order_items_tenant_draft_idx').on(table.tenantId, table.draftOrderId),
    check('draft_order_items_quantity_positive', sql`${table.quantity} > 0`),
    check('draft_order_items_unit_price_nonnegative', sql`${table.unitPrice} >= 0`),
    check(
      'draft_order_items_line_total_consistent',
      sql`${table.lineTotal} = ${table.unitPrice} * ${table.quantity}`,
    ),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    sourceDraftOrderId: uuid('source_draft_order_id').notNull(),
    customerId: uuid('customer_id'),
    number: text('number').notNull(),
    status: orderStatus('status').notNull().default('new'),
    version: integer('version').notNull().default(1),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone').notNull(),
    customerEmail: text('customer_email'),
    shippingAddress: jsonb('shipping_address').$type<Record<string, unknown>>().notNull(),
    notes: text('notes'),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    currency: text('currency').notNull(),
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull(),
    discountAmount: numeric('discount_amount', { precision: 14, scale: 2 }).notNull(),
    shippingAmount: numeric('shipping_amount', { precision: 14, scale: 2 }).notNull(),
    total: numeric('total', { precision: 14, scale: 2 }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    preparingAt: timestamp('preparing_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.sourceDraftOrderId],
      foreignColumns: [draftOrders.tenantId, draftOrders.id],
      name: 'orders_tenant_source_draft_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'orders_tenant_customer_fk',
    }).onDelete('restrict'),
    uniqueIndex('orders_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('orders_tenant_number_uq').on(table.tenantId, table.number),
    uniqueIndex('orders_tenant_source_draft_uq').on(table.tenantId, table.sourceDraftOrderId),
    index('orders_tenant_status_created_idx').on(table.tenantId, table.status, table.createdAt),
    index('orders_tenant_customer_created_idx').on(
      table.tenantId,
      table.customerId,
      table.createdAt,
    ),
    check('orders_version_positive', sql`${table.version} > 0`),
    check('orders_subtotal_nonnegative', sql`${table.subtotal} >= 0`),
    check('orders_discount_nonnegative', sql`${table.discountAmount} >= 0`),
    check('orders_shipping_nonnegative', sql`${table.shippingAmount} >= 0`),
    check('orders_total_nonnegative', sql`${table.total} >= 0`),
    check(
      'orders_total_consistent',
      sql`${table.total} = ${table.subtotal} - ${table.discountAmount} + ${table.shippingAmount}`,
    ),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    orderId: uuid('order_id').notNull(),
    productId: uuid('product_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    reservationId: uuid('reservation_id').notNull(),
    productNameSnapshot: text('product_name_snapshot').notNull(),
    productCodeSnapshot: text('product_code_snapshot').notNull(),
    variantNameSnapshot: text('variant_name_snapshot'),
    skuSnapshot: text('sku_snapshot').notNull(),
    variantAttributesSnapshot: jsonb('variant_attributes_snapshot')
      .$type<Record<string, unknown>>()
      .notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
    lineTotal: numeric('line_total', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.orderId],
      foreignColumns: [orders.tenantId, orders.id],
      name: 'order_items_tenant_order_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'order_items_tenant_product_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.variantId],
      foreignColumns: [productVariants.tenantId, productVariants.id],
      name: 'order_items_tenant_variant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [inventoryLocations.tenantId, inventoryLocations.id],
      name: 'order_items_tenant_location_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.reservationId],
      foreignColumns: [stockReservations.tenantId, stockReservations.id],
      name: 'order_items_tenant_reservation_fk',
    }).onDelete('restrict'),
    uniqueIndex('order_items_tenant_id_id_uq').on(table.tenantId, table.id),
    index('order_items_tenant_order_idx').on(table.tenantId, table.orderId),
    check('order_items_quantity_positive', sql`${table.quantity} > 0`),
    check('order_items_unit_price_nonnegative', sql`${table.unitPrice} >= 0`),
    check(
      'order_items_line_total_consistent',
      sql`${table.lineTotal} = ${table.unitPrice} * ${table.quantity}`,
    ),
  ],
);

export const orderCommands = pgTable(
  'order_commands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    orderId: uuid('order_id').notNull(),
    draftOrderId: uuid('draft_order_id'),
    type: orderCommandType('type').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    commandFingerprint: text('command_fingerprint').notNull(),
    resultStatus: orderStatus('result_status').notNull(),
    actorId: text('actor_id').notNull(),
    correlationId: text('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.orderId],
      foreignColumns: [orders.tenantId, orders.id],
      name: 'order_commands_tenant_order_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.draftOrderId],
      foreignColumns: [draftOrders.tenantId, draftOrders.id],
      name: 'order_commands_tenant_draft_fk',
    }).onDelete('restrict'),
    uniqueIndex('order_commands_tenant_idempotency_uq').on(table.tenantId, table.idempotencyKey),
    index('order_commands_tenant_order_idx').on(table.tenantId, table.orderId),
  ],
);

export const orderTransitions = pgTable(
  'order_transitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    orderId: uuid('order_id').notNull(),
    fromStatus: orderStatus('from_status'),
    toStatus: orderStatus('to_status').notNull(),
    actorId: text('actor_id').notNull(),
    reason: text('reason'),
    idempotencyKey: text('idempotency_key').notNull(),
    correlationId: text('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.orderId],
      foreignColumns: [orders.tenantId, orders.id],
      name: 'order_transitions_tenant_order_fk',
    }).onDelete('restrict'),
    index('order_transitions_tenant_order_created_idx').on(
      table.tenantId,
      table.orderId,
      table.createdAt,
    ),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    channel: conversationChannel('channel').notNull(),
    externalThreadId: text('external_thread_id'),
    status: conversationStatus('status').notNull().default('bot'),
    assignedToUserId: uuid('assigned_to_user_id'),
    subject: text('subject'),
    productId: uuid('product_id'),
    draftOrderId: uuid('draft_order_id'),
    orderId: uuid('order_id'),
    version: integer('version').notNull().default(1),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'conversations_tenant_customer_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.assignedToUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'conversations_tenant_assignee_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'conversations_tenant_product_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.draftOrderId],
      foreignColumns: [draftOrders.tenantId, draftOrders.id],
      name: 'conversations_tenant_draft_order_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.orderId],
      foreignColumns: [orders.tenantId, orders.id],
      name: 'conversations_tenant_order_fk',
    }).onDelete('restrict'),
    uniqueIndex('conversations_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('conversations_tenant_channel_external_thread_uq').on(
      table.tenantId,
      table.channel,
      table.externalThreadId,
    ),
    index('conversations_tenant_status_last_message_idx').on(
      table.tenantId,
      table.status,
      table.lastMessageAt,
    ),
    index('conversations_tenant_customer_created_idx').on(
      table.tenantId,
      table.customerId,
      table.createdAt,
    ),
    check('conversations_version_positive', sql`${table.version} > 0`),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    direction: messageDirection('direction').notNull(),
    senderType: messageSenderType('sender_type').notNull(),
    senderId: text('sender_id'),
    externalId: text('external_id'),
    fingerprint: text('fingerprint').notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
      name: 'messages_tenant_conversation_fk',
    }).onDelete('cascade'),
    uniqueIndex('messages_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('messages_tenant_conversation_external_uq').on(
      table.tenantId,
      table.conversationId,
      table.externalId,
    ),
    index('messages_tenant_conversation_created_idx').on(
      table.tenantId,
      table.conversationId,
      table.createdAt,
    ),
    check('messages_fingerprint_not_blank', sql`length(trim(${table.fingerprint})) > 0`),
    check('messages_content_not_blank', sql`length(trim(${table.content})) > 0`),
  ],
);

export const conversationTransitions = pgTable(
  'conversation_transitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    fromStatus: conversationStatus('from_status'),
    toStatus: conversationStatus('to_status').notNull(),
    actorId: text('actor_id').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
      name: 'conversation_transitions_tenant_conversation_fk',
    }).onDelete('cascade'),
    uniqueIndex('conversation_transitions_tenant_id_id_uq').on(table.tenantId, table.id),
    index('conversation_transitions_tenant_conversation_created_idx').on(
      table.tenantId,
      table.conversationId,
      table.createdAt,
    ),
  ],
);

export const businessRuleSets = pgTable(
  'business_rule_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('business_rule_sets_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('business_rule_sets_tenant_key_uq').on(table.tenantId, table.key),
    index('business_rule_sets_tenant_updated_idx').on(table.tenantId, table.updatedAt),
    check('business_rule_sets_key_not_blank', sql`length(trim(${table.key})) > 0`),
    check('business_rule_sets_name_not_blank', sql`length(trim(${table.name})) > 0`),
    check('business_rule_sets_version_positive', sql`${table.version} > 0`),
  ],
);

export const businessRuleVersions = pgTable(
  'business_rule_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    ruleSetId: uuid('rule_set_id').notNull(),
    version: integer('version').notNull(),
    status: configurationVersionStatus('status').notNull().default('draft'),
    policy: jsonb('policy').$type<Record<string, unknown>>().notNull(),
    changeNote: text('change_note'),
    createdBy: text('created_by').notNull(),
    publishedBy: text('published_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.ruleSetId],
      foreignColumns: [businessRuleSets.tenantId, businessRuleSets.id],
      name: 'business_rule_versions_tenant_set_fk',
    }).onDelete('cascade'),
    uniqueIndex('business_rule_versions_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('business_rule_versions_tenant_set_id_uq').on(
      table.tenantId,
      table.ruleSetId,
      table.id,
    ),
    uniqueIndex('business_rule_versions_tenant_set_version_uq').on(
      table.tenantId,
      table.ruleSetId,
      table.version,
    ),
    uniqueIndex('business_rule_versions_one_draft_uq')
      .on(table.tenantId, table.ruleSetId)
      .where(sql`${table.status} = 'draft'`),
    uniqueIndex('business_rule_versions_one_published_uq')
      .on(table.tenantId, table.ruleSetId)
      .where(sql`${table.status} = 'published'`),
    index('business_rule_versions_tenant_set_status_idx').on(
      table.tenantId,
      table.ruleSetId,
      table.status,
      table.version,
    ),
    check('business_rule_versions_version_positive', sql`${table.version} > 0`),
  ],
);

export const knowledgeEntries = pgTable(
  'knowledge_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    kind: knowledgeEntryKind('kind').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('knowledge_entries_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('knowledge_entries_tenant_slug_uq').on(table.tenantId, table.slug),
    index('knowledge_entries_tenant_kind_updated_idx').on(
      table.tenantId,
      table.kind,
      table.updatedAt,
    ),
    check('knowledge_entries_slug_not_blank', sql`length(trim(${table.slug})) > 0`),
    check('knowledge_entries_version_positive', sql`${table.version} > 0`),
  ],
);

export const knowledgeVersions = pgTable(
  'knowledge_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    entryId: uuid('entry_id').notNull(),
    version: integer('version').notNull(),
    status: configurationVersionStatus('status').notNull().default('draft'),
    title: text('title').notNull(),
    question: text('question'),
    content: text('content').notNull(),
    changeNote: text('change_note'),
    createdBy: text('created_by').notNull(),
    publishedBy: text('published_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.entryId],
      foreignColumns: [knowledgeEntries.tenantId, knowledgeEntries.id],
      name: 'knowledge_versions_tenant_entry_fk',
    }).onDelete('cascade'),
    uniqueIndex('knowledge_versions_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('knowledge_versions_tenant_entry_version_uq').on(
      table.tenantId,
      table.entryId,
      table.version,
    ),
    uniqueIndex('knowledge_versions_one_draft_uq')
      .on(table.tenantId, table.entryId)
      .where(sql`${table.status} = 'draft'`),
    uniqueIndex('knowledge_versions_one_published_uq')
      .on(table.tenantId, table.entryId)
      .where(sql`${table.status} = 'published'`),
    index('knowledge_versions_tenant_entry_status_idx').on(
      table.tenantId,
      table.entryId,
      table.status,
      table.version,
    ),
    check('knowledge_versions_version_positive', sql`${table.version} > 0`),
    check('knowledge_versions_title_not_blank', sql`length(trim(${table.title})) > 0`),
    check('knowledge_versions_content_not_blank', sql`length(trim(${table.content})) > 0`),
  ],
);

export const agentSettingsVersions = pgTable(
  'agent_settings_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: configurationVersionStatus('status').notNull().default('draft'),
    language: text('language').notNull(),
    tone: agentTone('tone').notNull(),
    handoffNotes: text('handoff_notes').notNull().default(''),
    changeNote: text('change_note'),
    createdBy: text('created_by').notNull(),
    publishedBy: text('published_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('agent_settings_versions_tenant_id_id_uq').on(table.tenantId, table.id),
    uniqueIndex('agent_settings_versions_tenant_version_uq').on(table.tenantId, table.version),
    uniqueIndex('agent_settings_versions_one_draft_uq')
      .on(table.tenantId)
      .where(sql`${table.status} = 'draft'`),
    uniqueIndex('agent_settings_versions_one_published_uq')
      .on(table.tenantId)
      .where(sql`${table.status} = 'published'`),
    index('agent_settings_versions_tenant_status_idx').on(
      table.tenantId,
      table.status,
      table.version,
    ),
    check('agent_settings_versions_version_positive', sql`${table.version} > 0`),
    check('agent_settings_versions_language_allowed', sql`${table.language} in ('ar', 'fr', 'en')`),
    check(
      'agent_settings_versions_handoff_notes_length',
      sql`length(${table.handoffNotes}) <= 1000`,
    ),
  ],
);

export const pricingDecisions = pgTable(
  'pricing_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    ruleSetId: uuid('rule_set_id').notNull(),
    ruleVersionId: uuid('rule_version_id').notNull(),
    ruleVersion: integer('rule_version').notNull(),
    productId: uuid('product_id'),
    conversationId: uuid('conversation_id'),
    currency: text('currency').notNull(),
    listPrice: numeric('list_price', { precision: 14, scale: 2 }).notNull(),
    requestedPrice: numeric('requested_price', { precision: 14, scale: 2 }).notNull(),
    decidedPrice: numeric('decided_price', { precision: 14, scale: 2 }),
    outcome: priceDecisionOutcome('outcome').notNull(),
    reason: text('reason').notNull(),
    correlationId: text('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.ruleSetId],
      foreignColumns: [businessRuleSets.tenantId, businessRuleSets.id],
      name: 'pricing_decisions_tenant_set_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.ruleSetId, table.ruleVersionId],
      foreignColumns: [
        businessRuleVersions.tenantId,
        businessRuleVersions.ruleSetId,
        businessRuleVersions.id,
      ],
      name: 'pricing_decisions_tenant_rule_version_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'pricing_decisions_tenant_product_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
      name: 'pricing_decisions_tenant_conversation_fk',
    }).onDelete('restrict'),
    uniqueIndex('pricing_decisions_tenant_id_id_uq').on(table.tenantId, table.id),
    index('pricing_decisions_tenant_set_created_idx').on(
      table.tenantId,
      table.ruleSetId,
      table.createdAt,
    ),
    check('pricing_decisions_rule_version_positive', sql`${table.ruleVersion} > 0`),
    check('pricing_decisions_list_price_nonnegative', sql`${table.listPrice} >= 0`),
    check('pricing_decisions_requested_price_nonnegative', sql`${table.requestedPrice} >= 0`),
    check(
      'pricing_decisions_decided_price_nonnegative',
      sql`${table.decidedPrice} is null or ${table.decidedPrice} >= 0`,
    ),
  ],
);

export const aiRuns = pgTable(
  'ai_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id'),
    task: aiTask('task').notNull(),
    intent: aiIntent('intent').notNull(),
    promptVersion: text('prompt_version').notNull(),
    routingVersion: text('routing_version'),
    provider: text('provider'),
    model: text('model'),
    modelVersion: text('model_version'),
    outcome: aiRunOutcome('outcome').notNull(),
    handoffReason: text('handoff_reason'),
    latencyMs: integer('latency_ms').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 14, scale: 6 }).notNull(),
    attemptCount: integer('attempt_count').notNull(),
    fallbackUsed: boolean('fallback_used').notNull().default(false),
    safeInput: jsonb('safe_input').$type<unknown>().notNull(),
    safeOutput: jsonb('safe_output').$type<unknown>().notNull(),
    attempts: jsonb('attempts').$type<unknown[]>().notNull().default([]),
    correlationId: text('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
      name: 'ai_runs_tenant_conversation_fk',
    }).onDelete('restrict'),
    uniqueIndex('ai_runs_tenant_id_id_uq').on(table.tenantId, table.id),
    index('ai_runs_tenant_created_idx').on(table.tenantId, table.createdAt),
    index('ai_runs_tenant_conversation_created_idx').on(
      table.tenantId,
      table.conversationId,
      table.createdAt,
    ),
    check('ai_runs_latency_nonnegative', sql`${table.latencyMs} >= 0`),
    check('ai_runs_input_tokens_nonnegative', sql`${table.inputTokens} >= 0`),
    check('ai_runs_output_tokens_nonnegative', sql`${table.outputTokens} >= 0`),
    check('ai_runs_cost_nonnegative', sql`${table.estimatedCostUsd} >= 0`),
    check('ai_runs_attempt_count_nonnegative', sql`${table.attemptCount} >= 0`),
    check('ai_runs_prompt_version_not_blank', sql`length(trim(${table.promptVersion})) > 0`),
    check('ai_runs_correlation_id_not_blank', sql`length(trim(${table.correlationId})) > 0`),
    check(
      'ai_runs_outcome_shape',
      sql`(
        (${table.outcome} = 'completed'
          and ${table.provider} is not null
          and ${table.model} is not null
          and ${table.modelVersion} is not null
          and ${table.routingVersion} is not null
          and ${table.handoffReason} is null)
        or
        (${table.outcome} = 'handoff' and ${table.handoffReason} is not null)
      )`,
    ),
  ],
);

export const aiToolCalls = pgTable(
  'ai_tool_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    runId: uuid('run_id').notNull(),
    providerCallId: text('provider_call_id').notNull(),
    name: text('name').notNull(),
    kind: aiToolKind('kind').notNull(),
    status: aiToolCallStatus('status').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    safeInput: jsonb('safe_input').$type<unknown>().notNull(),
    safeOutput: jsonb('safe_output').$type<unknown>().notNull(),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.runId],
      foreignColumns: [aiRuns.tenantId, aiRuns.id],
      name: 'ai_tool_calls_tenant_run_fk',
    }).onDelete('cascade'),
    uniqueIndex('ai_tool_calls_tenant_id_id_uq').on(table.tenantId, table.id),
    index('ai_tool_calls_tenant_run_created_idx').on(table.tenantId, table.runId, table.createdAt),
    check('ai_tool_calls_name_not_blank', sql`length(trim(${table.name})) > 0`),
    check('ai_tool_calls_provider_id_not_blank', sql`length(trim(${table.providerCallId})) > 0`),
    check('ai_tool_calls_latency_nonnegative', sql`${table.latencyMs} >= 0`),
    check(
      'ai_tool_calls_status_shape',
      sql`(
        (${table.status} = 'succeeded' and ${table.errorCode} is null)
        or
        (${table.status} in ('rejected', 'failed') and ${table.errorCode} is not null)
      )`,
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
