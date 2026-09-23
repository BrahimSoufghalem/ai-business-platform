import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseTenantId } from '@ai-business/domain';
import { createDatabaseClient, withTenantTransaction } from './client.js';
import { receiveInventory } from './inventory-commands.js';
import { parsePilotSeedManifest } from './pilot-seed-manifest.js';

async function main(): Promise<void> {
  if (process.env.PILOT_SEED_CONFIRM !== 'SEED_EXISTING_TENANT') {
    throw new Error('Set PILOT_SEED_CONFIRM=SEED_EXISTING_TENANT to run this operator command.');
  }
  const manifestPath = process.argv[2] ?? process.env.PILOT_SEED_MANIFEST;
  if (!manifestPath) throw new Error('Provide the Pilot seed manifest path.');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  const rawManifest = await readFile(manifestPath, 'utf8');
  const manifest = parsePilotSeedManifest(JSON.parse(rawManifest) as unknown);
  const digest = createHash('sha256').update(rawManifest).digest('hex');
  const correlationId = `pilot-seed:${digest.slice(0, 24)}`;
  const client = createDatabaseClient(databaseUrl);
  try {
    const summary = await withTenantTransaction(
      client,
      {
        tenantId: parseTenantId(manifest.tenantId),
        actor: { type: 'user', id: manifest.identitySubject },
        correlationId,
      },
      async (transaction) => {
        const [productType] = await transaction<{ id: string }[]>`
          insert into product_types (tenant_id, name, slug, status)
          values (
            ${manifest.tenantId}, ${manifest.productType.name},
            ${manifest.productType.slug}, 'active'
          )
          on conflict (tenant_id, slug) do update
          set name = excluded.name, status = 'active', updated_at = now()
          returning id::text
        `;
        if (!productType) throw new Error('Pilot product type could not be created.');
        const [location] = await transaction<{ id: string }[]>`
          insert into inventory_locations (
            tenant_id, code, name, is_default, status
          ) values (
            ${manifest.tenantId}, ${manifest.location.code},
            ${manifest.location.name}, ${manifest.location.isDefault}, 'active'
          )
          on conflict (tenant_id, code) do update
          set
            name = excluded.name,
            status = 'active',
            updated_at = now()
          returning id::text
        `;
        if (!location) throw new Error('Pilot inventory location could not be created.');

        let receivedUnits = 0;
        for (const productInput of manifest.products) {
          const [product] = await transaction<{ id: string }[]>`
            insert into products (
              tenant_id, product_type_id, code, name, description, base_price,
              currency, status, custom_attributes, product_type_schema_version,
              published_at
            ) values (
              ${manifest.tenantId}, ${productType.id}, ${productInput.code},
              ${productInput.name}, ${productInput.description},
              ${productInput.price.toFixed(2)}, ${manifest.currency}, 'active',
              '{}'::jsonb, 1, now()
            )
            on conflict (tenant_id, code) do update
            set
              name = excluded.name,
              description = excluded.description,
              base_price = excluded.base_price,
              currency = excluded.currency,
              status = 'active',
              updated_at = now()
            returning id::text
          `;
          if (!product) throw new Error(`Product ${productInput.code} could not be created.`);
          const [variant] = await transaction<{ id: string; productId: string }[]>`
            insert into product_variants (
              tenant_id, product_id, sku, name, attributes, status
            ) values (
              ${manifest.tenantId}, ${product.id}, ${productInput.sku},
              ${productInput.variantName}, '{}'::jsonb, 'active'
            )
            on conflict (tenant_id, sku) do update
            set
              name = excluded.name,
              status = 'active',
              updated_at = now()
            returning id::text, product_id::text as "productId"
          `;
          if (!variant || variant.productId !== product.id) {
            throw new Error(`SKU ${productInput.sku} is already linked to another product.`);
          }
          await transaction`
            insert into inventory_balances (
              tenant_id, location_id, variant_id, on_hand, reserved, reorder_point
            ) values (
              ${manifest.tenantId}, ${location.id}, ${variant.id}, 0, 0,
              ${productInput.reorderPoint}
            )
            on conflict (tenant_id, location_id, variant_id) do update
            set reorder_point = excluded.reorder_point, updated_at = now()
          `;
          if (productInput.onHand > 0) {
            const inventoryKey = createHash('sha256')
              .update(`${productInput.code}:${productInput.sku}`)
              .digest('hex')
              .slice(0, 24);
            const received = await receiveInventory(
              transaction,
              {
                tenantId: manifest.tenantId,
                actorId: manifest.identitySubject,
                correlationId,
              },
              {
                locationId: location.id,
                variantId: variant.id,
                quantity: productInput.onHand,
                idempotencyKey: `pilot-seed:${inventoryKey}:stock`,
                referenceType: 'pilot_seed',
                referenceId: digest.slice(0, 24),
                metadata: { source: 'pilot_seed' },
              },
            );
            if (!received.replayed) receivedUnits += productInput.onHand;
          }
        }
        await transaction`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action, entity_type, entity_id,
            correlation_id, metadata
          ) values (
            ${manifest.tenantId}, 'user', ${manifest.identitySubject},
            'pilot.seed.applied', 'tenant', ${manifest.tenantId},
            ${correlationId},
            ${transaction.json({
              manifestSha256: digest,
              productCount: manifest.products.length,
              receivedUnits,
            })}
          )
        `;
        return { productCount: manifest.products.length, receivedUnits, correlationId };
      },
    );
    console.log(JSON.stringify({ event: 'pilot_seed_completed', ...summary }));
  } finally {
    await client.end({ timeout: 5 });
  }
}

void main();
