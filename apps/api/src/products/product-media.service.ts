import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { createProductMediaObjectKey } from '@ai-business/storage';
import { withTenantTransaction } from '@ai-business/db';
import { DatabaseService } from '../database/database.service.js';
import { StorageService } from '../storage/storage.service.js';
import { authorizeTenantPermission } from '../tenancy/tenant-authorization.js';
import { createCandidateTenantContext } from '../tenancy/trusted-tenant-context.js';
import type { CreateMediaTicketInput } from './product.schemas.js';

@Injectable()
export class ProductMediaService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  async createUploadTicket(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    productId: string,
    input: CreateMediaTicketInput,
  ) {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    const mediaId = randomUUID();
    const objectKey = createProductMediaObjectKey({
      tenantId: context.tenantId,
      productId,
      mediaId,
      filename: input.filename,
    });
    const ticket = await this.storage.client.createUploadTicket({
      objectKey,
      contentType: input.contentType,
    });

    await withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'catalog:write');
      const [product] = await transaction<{ id: string }[]>`
        select id::text from products
        where tenant_id = ${context.tenantId} and id = ${productId}
        limit 1
      `;
      if (!product) throw new NotFoundException('Product not found.');
      await transaction`
        insert into product_media (
          id, tenant_id, product_id, object_key, original_filename,
          content_type, alt_text, sort_order, status
        ) values (
          ${mediaId}, ${context.tenantId}, ${productId}, ${objectKey}, ${input.filename},
          ${input.contentType}, ${input.altText ?? null}, ${input.sortOrder}, 'pending'
        )
      `;
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type, entity_id,
          correlation_id, metadata
        ) values (
          ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject}, 'product_media.ticket_created',
          'product_media', ${mediaId}, ${correlationId},
          ${transaction.json({ productId, contentType: input.contentType })}
        )
      `;
    });

    return { mediaId, ...ticket };
  }

  async complete(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    productId: string,
    mediaId: string,
  ) {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    const media = await withTenantTransaction(
      this.database.client,
      context,
      async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'catalog:write');
        const [row] = await transaction<
          { objectKey: string; expectedContentType: string; status: string }[]
        >`
        select object_key as "objectKey", content_type as "expectedContentType", status::text
        from product_media
        where tenant_id = ${context.tenantId} and product_id = ${productId} and id = ${mediaId}
        limit 1
      `;
        if (!row) throw new NotFoundException('Product media not found.');
        return row;
      },
    );

    const metadata = await this.storage.client.head(media.objectKey);
    if (metadata.contentType && metadata.contentType !== media.expectedContentType) {
      throw new BadRequestException('Uploaded media content type does not match the ticket.');
    }

    await withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'catalog:write');
      await transaction`
        update product_media
        set status = 'ready', size_bytes = ${metadata.sizeBytes}, updated_at = now()
        where tenant_id = ${context.tenantId} and product_id = ${productId} and id = ${mediaId}
      `;
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type, entity_id,
          correlation_id, metadata
        ) values (
          ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject}, 'product_media.completed',
          'product_media', ${mediaId}, ${correlationId},
          ${transaction.json({ productId, sizeBytes: metadata.sizeBytes })}
        )
      `;
    });

    return { mediaId, status: 'ready' as const, ...metadata };
  }

  async getDownloadUrl(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    productId: string,
    mediaId: string,
  ) {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    const media = await withTenantTransaction(
      this.database.client,
      context,
      async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'catalog:read');
        const [row] = await transaction<
          { objectKey: string; status: 'pending' | 'ready' | 'failed' }[]
        >`
        select object_key as "objectKey", status::text
        from product_media
        where tenant_id = ${context.tenantId} and product_id = ${productId} and id = ${mediaId}
        limit 1
      `;
        if (!row) throw new NotFoundException('Product media not found.');
        if (row.status !== 'ready') throw new BadRequestException('Product media is not ready.');
        return row;
      },
    );
    return {
      mediaId,
      downloadUrl: await this.storage.client.createDownloadUrl(media.objectKey),
      expiresInSeconds: 300,
    };
  }
}
