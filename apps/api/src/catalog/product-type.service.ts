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
  getProductTypeTemplate,
  validateAttributeDefinitions,
  type AttributeDefinition,
} from '@ai-business/domain';
import { withTenantTransaction, type TenantTransaction } from '@ai-business/db';
import { DatabaseService } from '../database/database.service.js';
import { createCandidateTenantContext } from '../tenancy/trusted-tenant-context.js';
import { authorizeTenantPermission } from '../tenancy/tenant-authorization.js';
import type { CreateProductTypeInput, UpdateProductTypeInput } from './product-type.schemas.js';

interface ProductTypeRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  templateKey: string | null;
  schemaVersion: number;
  status: 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

interface AttributeRow {
  key: string;
  label: string;
  dataType: AttributeDefinition['dataType'];
  required: boolean;
  searchable: boolean;
  variantAxis: boolean;
  options: string[];
  position: number;
}

export interface ProductTypeView {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly templateKey: string | null;
  readonly schemaVersion: number;
  readonly status: 'active' | 'archived';
  readonly attributes: readonly AttributeDefinition[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

@Injectable()
export class ProductTypeService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private validateDefinitions(
    definitions: Parameters<typeof validateAttributeDefinitions>[0],
  ): readonly AttributeDefinition[] {
    try {
      return validateAttributeDefinitions(definitions);
    } catch (error) {
      if (error instanceof CatalogSchemaValidationError) {
        throw new BadRequestException({
          message: error.message,
          issues: error.issues,
        });
      }
      throw error;
    }
  }

  private async loadOne(
    transaction: TenantTransaction,
    tenantId: string,
    productTypeId: string,
  ): Promise<ProductTypeView | null> {
    const [row] = await transaction<ProductTypeRow[]>`
      select
        id::text, name, slug, description, template_key as "templateKey",
        schema_version as "schemaVersion", status::text,
        created_at as "createdAt", updated_at as "updatedAt"
      from product_types
      where tenant_id = ${tenantId} and id = ${productTypeId}
      limit 1
    `;
    if (!row) return null;

    const attributes = await transaction<AttributeRow[]>`
      select
        key, label, data_type::text as "dataType", required, searchable,
        variant_axis as "variantAxis", options, position
      from attribute_definitions
      where tenant_id = ${tenantId} and product_type_id = ${productTypeId}
      order by position
    `;

    return {
      ...row,
      attributes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async insertAttributes(
    transaction: TenantTransaction,
    tenantId: string,
    productTypeId: string,
    attributes: readonly AttributeDefinition[],
  ): Promise<void> {
    if (attributes.length === 0) return;
    const rows = attributes.map((attribute) => ({
      tenant_id: tenantId,
      product_type_id: productTypeId,
      key: attribute.key,
      label: attribute.label,
      data_type: attribute.dataType,
      required: attribute.required,
      searchable: attribute.searchable,
      variant_axis: attribute.variantAxis,
      options: transaction.json(attribute.options),
      position: attribute.position,
    }));
    await transaction`
      insert into attribute_definitions ${transaction(
        rows,
        'tenant_id',
        'product_type_id',
        'key',
        'label',
        'data_type',
        'required',
        'searchable',
        'variant_axis',
        'options',
        'position',
      )}
    `;
  }

  async list(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
  ): Promise<ProductTypeView[]> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'catalog:read');
      const ids = await transaction<{ id: string }[]>`
        select id::text from product_types
        where tenant_id = ${context.tenantId}
        order by created_at, id
      `;
      const result: ProductTypeView[] = [];
      for (const { id } of ids) {
        const item = await this.loadOne(transaction, context.tenantId, id);
        if (item) result.push(item);
      }
      return result;
    });
  }

  async get(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    productTypeId: string,
  ): Promise<ProductTypeView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'catalog:read');
      const item = await this.loadOne(transaction, context.tenantId, productTypeId);
      if (!item) throw new NotFoundException('Product type not found.');
      return item;
    });
  }

  async create(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: CreateProductTypeInput,
  ): Promise<ProductTypeView> {
    const template = input.templateKey ? getProductTypeTemplate(input.templateKey) : undefined;
    const attributes = this.validateDefinitions(input.attributes ?? template?.attributes ?? []);
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);

    try {
      return await withTenantTransaction(this.database.client, context, async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'catalog:write');
        const [created] = await transaction<{ id: string }[]>`
          insert into product_types (
            tenant_id, name, slug, description, template_key
          ) values (
            ${context.tenantId}, ${input.name}, ${input.slug},
            ${input.description ?? null}, ${input.templateKey ?? null}
          )
          returning id::text
        `;
        if (!created) throw new Error('Product type insert returned no ID.');
        await this.insertAttributes(transaction, context.tenantId, created.id, attributes);
        await transaction`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action, entity_type, entity_id,
            correlation_id, metadata
          ) values (
            ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject}, 'product_type.created',
            'product_type', ${created.id}, ${correlationId},
            ${transaction.json({ schemaVersion: 1, templateKey: input.templateKey ?? null })}
          )
        `;
        const item = await this.loadOne(transaction, context.tenantId, created.id);
        if (!item) throw new Error('Created product type could not be loaded.');
        return item;
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException('Product type slug already exists.');
      throw error;
    }
  }

  async update(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    productTypeId: string,
    input: UpdateProductTypeInput,
  ): Promise<ProductTypeView> {
    const attributes =
      input.attributes === undefined ? undefined : this.validateDefinitions(input.attributes);
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);

    try {
      return await withTenantTransaction(this.database.client, context, async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'catalog:write');
        const current = await this.loadOne(transaction, context.tenantId, productTypeId);
        if (!current) throw new NotFoundException('Product type not found.');
        if (current.schemaVersion !== input.expectedSchemaVersion) {
          throw new ConflictException({
            message: 'Product type schema changed; reload before saving.',
            currentSchemaVersion: current.schemaVersion,
          });
        }

        const [updated] = await transaction<{ id: string }[]>`
          update product_types
          set
            name = ${input.name ?? current.name},
            slug = ${input.slug ?? current.slug},
            description = ${input.description === undefined ? current.description : input.description},
            schema_version = schema_version + 1,
            updated_at = now()
          where tenant_id = ${context.tenantId}
            and id = ${productTypeId}
            and schema_version = ${input.expectedSchemaVersion}
          returning id::text
        `;
        if (!updated) throw new ConflictException('Product type changed concurrently.');

        if (attributes) {
          await transaction`
            delete from attribute_definitions
            where tenant_id = ${context.tenantId} and product_type_id = ${productTypeId}
          `;
          await this.insertAttributes(transaction, context.tenantId, productTypeId, attributes);
        }

        await transaction`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action, entity_type, entity_id,
            correlation_id, metadata
          ) values (
            ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject}, 'product_type.updated',
            'product_type', ${productTypeId}, ${correlationId},
            ${transaction.json({
              previousSchemaVersion: current.schemaVersion,
              schemaVersion: current.schemaVersion + 1,
            })}
          )
        `;

        const item = await this.loadOne(transaction, context.tenantId, productTypeId);
        if (!item) throw new Error('Updated product type could not be loaded.');
        return item;
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException('Product type slug already exists.');
      throw error;
    }
  }

  async archive(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    productTypeId: string,
  ): Promise<void> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    await withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'catalog:write');
      const [archived] = await transaction<{ id: string }[]>`
        update product_types
        set status = 'archived', updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${productTypeId}
        returning id::text
      `;
      if (!archived) throw new NotFoundException('Product type not found.');
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type, entity_id, correlation_id
        ) values (
          ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject}, 'product_type.archived',
          'product_type', ${productTypeId}, ${correlationId}
        )
      `;
    });
  }
}
