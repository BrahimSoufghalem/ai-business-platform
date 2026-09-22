import { BadRequestException, Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { CorrelationId, CurrentIdentity } from '../auth/request-context.decorator.js';
import { tenantIdSchema } from '../tenants/tenant.schemas.js';
import { parseWithSchema } from './http-validation.js';
import { createMediaTicketSchema, mediaIdSchema, productIdSchema } from './product.schemas.js';
import { ProductMediaService } from './product-media.service.js';

function uuid(schema: typeof productIdSchema, value: string, label: string): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException(`A valid ${label} UUID is required.`);
  return parsed.data;
}

@Controller('tenants/:tenantId/products/:productId/media')
export class ProductMediaController {
  constructor(@Inject(ProductMediaService) private readonly media: ProductMediaService) {}

  @Post('upload-ticket')
  createUploadTicket(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('productId') candidateProductId: string,
    @Body() body: unknown,
  ) {
    return this.media.createUploadTicket(
      identity,
      correlationId,
      uuid(tenantIdSchema, candidateTenantId, 'tenant'),
      uuid(productIdSchema, candidateProductId, 'product'),
      parseWithSchema(createMediaTicketSchema, body),
    );
  }

  @Post(':mediaId/complete')
  complete(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('productId') candidateProductId: string,
    @Param('mediaId') candidateMediaId: string,
  ) {
    return this.media.complete(
      identity,
      correlationId,
      uuid(tenantIdSchema, candidateTenantId, 'tenant'),
      uuid(productIdSchema, candidateProductId, 'product'),
      uuid(mediaIdSchema, candidateMediaId, 'media'),
    );
  }

  @Get(':mediaId/download')
  download(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('productId') candidateProductId: string,
    @Param('mediaId') candidateMediaId: string,
  ) {
    return this.media.getDownloadUrl(
      identity,
      correlationId,
      uuid(tenantIdSchema, candidateTenantId, 'tenant'),
      uuid(productIdSchema, candidateProductId, 'product'),
      uuid(mediaIdSchema, candidateMediaId, 'media'),
    );
  }
}
