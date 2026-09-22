import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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
