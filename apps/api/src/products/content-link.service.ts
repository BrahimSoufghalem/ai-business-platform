import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { withTenantTransaction } from '@ai-business/db';
import { DatabaseService } from '../database/database.service.js';
import { authorizeTenantPermission } from '../tenancy/tenant-authorization.js';
import { createCandidateTenantContext } from '../tenancy/trusted-tenant-context.js';
import type { ContentLinkInput } from './product.schemas.js';

@Injectable()
export class ContentLinkService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async map(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: ContentLinkInput,
  ) {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'catalog:write');
      const [product] = await transaction<{ id: string; code: string; name: string }[]>`
        select id::text, code, name from products
        where tenant_id = ${context.tenantId} and id = ${input.productId}
          and status <> 'archived'
        limit 1
      `;
      if (!product) throw new NotFoundException('Product not found.');
      const [link] = await transaction<{ id: string }[]>`
        insert into content_product_links (
          tenant_id, channel, external_content_id, product_id
        ) values (
          ${context.tenantId}, ${input.channel}, ${input.externalContentId}, ${input.productId}
        )
        on conflict (tenant_id, channel, external_content_id)
        do update set product_id = excluded.product_id, updated_at = now()
        returning id::text
      `;
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type, entity_id,
          correlation_id, metadata
        ) values (
          ${context.tenantId}, 'user', ${identity.subject}, 'content_product_link.mapped',
          'content_product_link', ${link?.id ?? 'unknown'}, ${correlationId},
          ${transaction.json({
            channel: input.channel,
            externalContentId: input.externalContentId,
            productId: input.productId,
          })}
        )
      `;
      return { ...input, product };
    });
  }

  async resolve(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    channel: 'instagram' | 'internal',
    externalContentId: string,
  ) {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'catalog:read');
      const [row] = await transaction<
        { productId: string; code: string; name: string; status: string }[]
      >`
        select
          product.id::text as "productId", product.code, product.name, product.status::text
        from content_product_links as link
        join products as product
          on product.tenant_id = link.tenant_id and product.id = link.product_id
        where link.tenant_id = ${context.tenantId}
          and link.channel = ${channel}
          and link.external_content_id = ${externalContentId}
        limit 1
      `;
      if (!row) throw new NotFoundException('No product mapping found.');
      return { channel, externalContentId, product: row };
    });
  }
}
