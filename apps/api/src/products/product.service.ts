import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import {
  CatalogSchemaValidationError,
  type AttributeDefinition,
  type ProductLifecycleStatus,
} from '@ai-business/domain';
import { withTenantTransaction, type TenantTransaction } from '@ai-business/db';
import { DatabaseService } from '../database/database.service.js';
import { authorizeTenantPermission } from '../tenancy/tenant-authorization.js';
import { createCandidateTenantContext } from '../tenancy/trusted-tenant-context.js';
import type {
  CreateProductInput,
  ProductSearchInput,
  UpdateProductInput,
} from './product.schemas.js';
import {
  validateProductConfiguration,
  type ValidatedVariant,
  type VariantInputLike,
} from './product-validation.js';

interface ProductTypeSchema {
  readonly id: string;
  readonly schemaVersion: number;
  readonly status: 'active' | 'archived';
  readonly definitions: readonly AttributeDefinition[];
}

interface ProductRow {
  id: string;
  productTypeId: string;
  code: string;
  name: string;
  description: string | null;
  basePrice: string;
  currency: string;
  status: ProductLifecycleStatus;
  customAttributes: Record<string, unknown>;
  productTypeSchemaVersion: number;
  version: number;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VariantView {
  readonly id: string;
  readonly sku: string;
  readonly name: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly priceOverride: string | null;
  readonly status: 'active' | 'archived';
}

export interface MediaView {
  readonly id: string;
  readonly originalFilename: string;
  readonly contentType: string;
  readonly sizeBytes: number | null;
  readonly altText: string | null;
  readonly sortOrder: number;
  readonly status: 'pending' | 'ready' | 'failed';
}

export interface ProductView {
  readonly id: string;
  readonly productTypeId: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly basePrice: string;
  readonly currency: string;
  readonly status: ProductLifecycleStatus;
  readonly customAttributes: Readonly<Record<string, unknown>>;
  readonly productTypeSchemaVersion: number;
  readonly version: number;
  readonly variants: readonly VariantView[];
  readonly media: readonly MediaView[];
  readonly publishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23503';
}

type JsonInput = Parameters<TenantTransaction['json']>[0];

function asJsonInput(value: unknown): JsonInput {
  return value as JsonInput;
}

@Injectable()
export class ProductService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private async loadProductTypeSchema(
    transaction: TenantTransaction,
    tenantId: string,
    productTypeId: string,
  ): Promise<ProductTypeSchema> {
    const [productType] = await transaction<
      { id: string; schemaVersion: number; status: 'active' | 'archived' }[]
    >`
      select id::text, schema_version as "schemaVersion", status::text
      from product_types
      where tenant_id = ${tenantId} and id = ${productTypeId}
      limit 1
    `;
    if (!productType) throw new BadRequestException('Product type not found.');
    if (productType.status !== 'active') {
      throw new BadRequestException('Archived product types cannot be assigned.');
    }
    const definitions = await transaction<AttributeDefinition[]>`
      select
        key, label, data_type::text as "dataType", required, searchable,
        variant_axis as "variantAxis", options, position
      from attribute_definitions
      where tenant_id = ${tenantId} and product_type_id = ${productTypeId}
      order by position
    `;
    return { ...productType, definitions };
  }

  private async loadOne(
    transaction: TenantTransaction,
    tenantId: string,
    productId: string,
  ): Promise<ProductView | null> {
    const [row] = await transaction<ProductRow[]>`
      select
        id::text, product_type_id::text as "productTypeId", code, name, description,
        base_price::text as "basePrice", currency, status::text,
        custom_attributes as "customAttributes",
        product_type_schema_version as "productTypeSchemaVersion", version,
        published_at as "publishedAt", created_at as "createdAt", updated_at as "updatedAt"
      from products
      where tenant_id = ${tenantId} and id = ${productId}
      limit 1
    `;
    if (!row) return null;

    const variants = await transaction<VariantView[]>`
      select
        id::text, sku, name, attributes, price_override::text as "priceOverride",
        status::text
      from product_variants
      where tenant_id = ${tenantId} and product_id = ${productId}
      order by created_at, id
    `;
    const media = await transaction<MediaView[]>`
      select
        id::text, original_filename as "originalFilename", content_type as "contentType",
        size_bytes::float8 as "sizeBytes", alt_text as "altText", sort_order as "sortOrder",
        status::text
      from product_media
      where tenant_id = ${tenantId} and product_id = ${productId}
      order by sort_order, created_at
    `;

    return {
      ...row,
      variants,
      media,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async insertVariants(
    transaction: TenantTransaction,
    tenantId: string,
    productId: string,
    variants: readonly ValidatedVariant[],
  ): Promise<void> {
    if (variants.length === 0) return;
    const rows = variants.map((variant) => ({
      tenant_id: tenantId,
      product_id: productId,
      sku: variant.sku,
      name: variant.name,
      attributes: transaction.json(asJsonInput(variant.attributes)),
      price_override: variant.priceOverride,
      status: variant.status,
    }));
    await transaction`
      insert into product_variants ${transaction(
        rows,
        'tenant_id',
        'product_id',
        'sku',
        'name',
        'attributes',
        'price_override',
        'status',
      )}
    `;
  }

  private async writeRevision(
    transaction: TenantTransaction,
    tenantId: string,
    actorId: string,
    product: ProductView,
  ): Promise<void> {
    await transaction`
      insert into product_revisions (tenant_id, product_id, version, snapshot, actor_id)
      values (
        ${tenantId}, ${product.id}, ${product.version},
        ${transaction.json(
          asJsonInput({
            productTypeId: product.productTypeId,
            productTypeSchemaVersion: product.productTypeSchemaVersion,
            code: product.code,
            name: product.name,
            description: product.description,
            basePrice: product.basePrice,
            currency: product.currency,
            status: product.status,
            customAttributes: product.customAttributes,
            variants: product.variants,
            publishedAt: product.publishedAt,
          }),
        )},
        ${actorId}
      )
    `;
  }

  private validateConfiguration(input: Parameters<typeof validateProductConfiguration>[0]) {
    try {
      return validateProductConfiguration(input);
    } catch (error) {
      if (error instanceof CatalogSchemaValidationError) {
        throw new BadRequestException({ message: error.message, issues: error.issues });
      }
      if (error instanceof Error) throw new BadRequestException(error.message);
      throw error;
    }
  }

  async search(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: ProductSearchInput,
  ): Promise<ProductView[]> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'catalog:read');
      const pattern = `%${input.q}%`;
      const ids = await transaction<{ id: string }[]>`
        select id::text
        from products
        where tenant_id = ${context.tenantId}
          and (
            ${input.q} = '' or code ilike ${pattern} or name ilike ${pattern}
            or coalesce(description, '') ilike ${pattern}
          )
          and (
            (${input.status ?? null}::product_status is null and status <> 'archived')
            or status = ${input.status ?? null}::product_status
          )
          and (${input.productTypeId ?? null}::uuid is null or product_type_id = ${input.productTypeId ?? null}::uuid)
        order by updated_at desc, id
        limit ${input.limit}
      `;
      const result: ProductView[] = [];
      for (const { id } of ids) {
        const product = await this.loadOne(transaction, context.tenantId, id);
        if (product) result.push(product);
      }
      return result;
    });
  }

  async get(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    productId: string,
  ): Promise<ProductView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'catalog:read');
      const product = await this.loadOne(transaction, context.tenantId, productId);
      if (!product) throw new NotFoundException('Product not found.');
      return product;
    });
  }

  async getByCode(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    code: string,
  ): Promise<ProductView> {
    const normalizedCode = code.trim().toUpperCase();
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'catalog:read');
      const [row] = await transaction<{ id: string }[]>`
        select id::text from products
        where tenant_id = ${context.tenantId} and code = ${normalizedCode}
        limit 1
      `;
      if (!row) throw new NotFoundException('Product not found.');
      const product = await this.loadOne(transaction, context.tenantId, row.id);
      if (!product) throw new NotFoundException('Product not found.');
      return product;
    });
  }

  async create(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: CreateProductInput,
  ): Promise<ProductView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    try {
      return await withTenantTransaction(this.database.client, context, async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'catalog:write');
        const schema = await this.loadProductTypeSchema(
          transaction,
          context.tenantId,
          input.productTypeId,
        );
        const validated = this.validateConfiguration({
          definitions: schema.definitions,
          lifecycleStatus: input.status,
          code: input.code,
          basePrice: input.basePrice,
          customAttributes: input.customAttributes,
          variants: input.variants,
        });
        const [created] = await transaction<{ id: string }[]>`
          insert into products (
            tenant_id, product_type_id, code, name, description, base_price,
            currency, status, custom_attributes, product_type_schema_version,
            published_at
          ) values (
            ${context.tenantId}, ${schema.id}, ${validated.code}, ${input.name},
            ${input.description ?? null}, ${validated.basePrice}, ${input.currency},
            ${input.status}, ${transaction.json(asJsonInput(validated.customAttributes))},
            ${schema.schemaVersion}, ${input.status === 'active' ? new Date() : null}
          )
          returning id::text
        `;
        if (!created) throw new Error('Product insert returned no ID.');
        await this.insertVariants(transaction, context.tenantId, created.id, validated.variants);
        const product = await this.loadOne(transaction, context.tenantId, created.id);
        if (!product) throw new Error('Created product could not be loaded.');
        await this.writeRevision(transaction, context.tenantId, identity.subject, product);
        await transaction`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action, entity_type, entity_id,
            correlation_id, metadata
          ) values (
            ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject}, 'product.created',
            'product', ${product.id}, ${correlationId},
            ${transaction.json({ code: product.code, version: product.version })}
          )
        `;
        return product;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Product code or variant SKU already exists.');
      }
      throw error;
    }
  }

  async update(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    productId: string,
    input: UpdateProductInput,
  ): Promise<ProductView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    try {
      return await withTenantTransaction(this.database.client, context, async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'catalog:write');
        const current = await this.loadOne(transaction, context.tenantId, productId);
        if (!current) throw new NotFoundException('Product not found.');
        if (current.version !== input.expectedVersion) {
          throw new ConflictException({
            message: 'Product changed; reload before saving.',
            currentVersion: current.version,
          });
        }
        const productTypeId = input.productTypeId ?? current.productTypeId;
        const schema = await this.loadProductTypeSchema(
          transaction,
          context.tenantId,
          productTypeId,
        );
        const variants: VariantInputLike[] = (input.variants ?? current.variants).map(
          (variant) => ({
            sku: variant.sku,
            name: variant.name,
            attributes: variant.attributes,
            priceOverride: variant.priceOverride,
            status: variant.status,
          }),
        );
        const validated = this.validateConfiguration({
          definitions: schema.definitions,
          lifecycleStatus: input.publish === true ? 'active' : current.status,
          code: input.code ?? current.code,
          basePrice: input.basePrice ?? current.basePrice,
          customAttributes: input.customAttributes ?? current.customAttributes,
          variants,
        });

        const [updated] = await transaction<{ id: string }[]>`
          update products
          set
            product_type_id = ${productTypeId}, code = ${validated.code},
            name = ${input.name ?? current.name},
            description = ${input.description === undefined ? current.description : input.description},
            base_price = ${validated.basePrice}, currency = ${input.currency ?? current.currency},
            custom_attributes = ${transaction.json(asJsonInput(validated.customAttributes))},
            product_type_schema_version = ${schema.schemaVersion},
            status = ${input.publish === true ? 'active' : current.status},
            published_at = ${
              input.publish === true ? (current.publishedAt ?? new Date()) : current.publishedAt
            },
            version = version + 1, updated_at = now()
          where tenant_id = ${context.tenantId} and id = ${productId}
            and version = ${input.expectedVersion}
          returning id::text
        `;
        if (!updated) throw new ConflictException('Product changed concurrently.');
        if (input.variants !== undefined || input.productTypeId !== undefined) {
          await transaction`
            delete from product_variants
            where tenant_id = ${context.tenantId} and product_id = ${productId}
          `;
          await this.insertVariants(transaction, context.tenantId, productId, validated.variants);
        }
        const product = await this.loadOne(transaction, context.tenantId, productId);
        if (!product) throw new Error('Updated product could not be loaded.');
        await this.writeRevision(transaction, context.tenantId, identity.subject, product);
        await transaction`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action, entity_type, entity_id,
            correlation_id, metadata
          ) values (
            ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject},
            ${input.publish === true && current.status !== 'active' ? 'product.published' : 'product.updated'},
            'product', ${productId}, ${correlationId},
            ${transaction.json({ previousVersion: current.version, version: product.version })}
          )
        `;
        return product;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Product code or variant SKU already exists.');
      }
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          'Variants with inventory history cannot be replaced; archive them and add a new variant.',
        );
      }
      throw error;
    }
  }

  async publish(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    productId: string,
  ): Promise<ProductView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'catalog:write');
      const current = await this.loadOne(transaction, context.tenantId, productId);
      if (!current) throw new NotFoundException('Product not found.');
      if (current.status === 'archived')
        throw new BadRequestException('Archived products cannot be published.');
      if (current.status === 'active') return current;
      const schema = await this.loadProductTypeSchema(
        transaction,
        context.tenantId,
        current.productTypeId,
      );
      this.validateConfiguration({
        definitions: schema.definitions,
        lifecycleStatus: 'active',
        code: current.code,
        basePrice: current.basePrice,
        customAttributes: current.customAttributes,
        variants: current.variants,
      });
      await transaction`
        update products
        set status = 'active', published_at = now(), version = version + 1,
            product_type_schema_version = ${schema.schemaVersion}, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${productId}
      `;
      const product = await this.loadOne(transaction, context.tenantId, productId);
      if (!product) throw new Error('Published product could not be loaded.');
      await this.writeRevision(transaction, context.tenantId, identity.subject, product);
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type, entity_id, correlation_id
        ) values (
          ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject}, 'product.published',
          'product', ${productId}, ${correlationId}
        )
      `;
      return product;
    });
  }

  async archive(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    productId: string,
  ): Promise<void> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    await withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'catalog:write');
      const [updated] = await transaction<{ id: string }[]>`
        update products
        set status = 'archived', version = version + 1, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${productId}
        returning id::text
      `;
      if (!updated) throw new NotFoundException('Product not found.');
      const product = await this.loadOne(transaction, context.tenantId, productId);
      if (!product) throw new Error('Archived product could not be loaded.');
      await this.writeRevision(transaction, context.tenantId, identity.subject, product);
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type, entity_id, correlation_id
        ) values (
          ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject}, 'product.archived',
          'product', ${productId}, ${correlationId}
        )
      `;
    });
  }

  async restore(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    productId: string,
  ): Promise<ProductView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'catalog:write');
      const current = await this.loadOne(transaction, context.tenantId, productId);
      if (!current) throw new NotFoundException('Product not found.');
      if (current.status !== 'archived') return current;

      await transaction`
        update products
        set status = 'draft', published_at = null, version = version + 1, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${productId}
      `;
      const product = await this.loadOne(transaction, context.tenantId, productId);
      if (!product) throw new Error('Restored product could not be loaded.');
      await this.writeRevision(transaction, context.tenantId, identity.subject, product);
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type, entity_id, correlation_id
        ) values (
          ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject}, 'product.restored',
          'product', ${productId}, ${correlationId}
        )
      `;
      return product;
    });
  }
}
