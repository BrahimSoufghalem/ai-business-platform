import { BadRequestException, ConflictException } from '@nestjs/common';
import { createDatabaseClient } from '@ai-business/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProductTypeService, type ProductTypeView } from '../src/catalog/product-type.service.js';
import { DatabaseService } from '../src/database/database.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const tenantA = '24242424-2424-4424-8424-242424242424';
const tenantB = '25252525-2525-4525-8525-252525252525';
const userId = '26262626-2626-4626-8626-262626262626';
const identity = {
  subject: 'product-types-integration-user',
  issuer: 'https://identity.example.test',
} as const;

describeWithDatabase('dynamic product types', () => {
  if (!databaseUrl) return;

  const admin = createDatabaseClient(databaseUrl);
  let database: DatabaseService;
  let productTypes: ProductTypeService;
  let smartphone: ProductTypeView;
  let clothing: ProductTypeView;
  let otherTenantType: ProductTypeView;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    await admin`
      insert into tenants (id, name)
      values
        (${tenantA}, 'Product Types A'),
        (${tenantB}, 'Product Types B')
      on conflict (id) do update set name = excluded.name
    `;
    await admin`
      insert into app_users (id, identity_provider_id, email)
      values (${userId}, ${identity.subject}, 'product-types@example.test')
      on conflict (identity_provider_id) do update set email = excluded.email
    `;
    await admin`
      insert into memberships (tenant_id, user_id, role, status)
      values
        (${tenantA}, ${userId}, 'owner', 'active'),
        (${tenantB}, ${userId}, 'owner', 'active')
      on conflict (tenant_id, user_id) do update set status = 'active', role = 'owner'
    `;

    database = new DatabaseService();
    productTypes = new ProductTypeService(database);
    smartphone = await productTypes.create(identity, 'type-phone', tenantA, {
      name: 'Smartphones',
      slug: 'smartphones',
      templateKey: 'smartphone',
    });
    clothing = await productTypes.create(identity, 'type-clothing', tenantA, {
      name: 'Clothing',
      slug: 'clothing',
      templateKey: 'clothing',
    });
    otherTenantType = await productTypes.create(identity, 'type-other', tenantB, {
      name: 'Other tenant type',
      slug: 'other-type',
      templateKey: 'general',
    });
  });

  afterAll(async () => {
    await admin`delete from product_types where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from audit_events where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from memberships where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from app_users where id = ${userId}`;
    await database.onApplicationShutdown();
    await admin.end();
  });

  it('creates smartphone and clothing schemas without a core migration', async () => {
    expect(smartphone.attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'storage', variantAxis: true }),
        expect.objectContaining({ key: 'ram_gb', dataType: 'number' }),
      ]),
    );
    expect(clothing.attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'size', options: expect.arrayContaining(['S', 'M', 'L']) }),
        expect.objectContaining({ key: 'color', searchable: true }),
      ]),
    );
  });

  it('keeps list and lookup results tenant-scoped', async () => {
    const tenantATypes = await productTypes.list(identity, 'type-list-a', tenantA);
    expect(tenantATypes.map((item) => item.id)).toEqual(
      expect.arrayContaining([smartphone.id, clothing.id]),
    );
    expect(tenantATypes.map((item) => item.id)).not.toContain(otherTenantType.id);
  });

  it('rejects invalid attribute definitions with a clear validation error', async () => {
    await expect(
      productTypes.create(identity, 'type-invalid', tenantA, {
        name: 'Invalid select',
        slug: 'invalid-select',
        attributes: [
          {
            key: 'finish',
            label: 'Finish',
            dataType: 'select',
            options: [],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uses schema versions to reject a stale editor', async () => {
    const updated = await productTypes.update(identity, 'type-update', tenantA, smartphone.id, {
      expectedSchemaVersion: smartphone.schemaVersion,
      description: 'Updated schema',
    });
    expect(updated.schemaVersion).toBe(smartphone.schemaVersion + 1);
    await expect(
      productTypes.update(identity, 'type-stale', tenantA, smartphone.id, {
        expectedSchemaVersion: smartphone.schemaVersion,
        name: 'Stale edit',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
