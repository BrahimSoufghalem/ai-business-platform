import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { CorrelationId, CurrentIdentity } from '../auth/request-context.decorator.js';
import { tenantIdSchema } from '../tenants/tenant.schemas.js';
import { ContentLinkService } from './content-link.service.js';
import { parseWithSchema } from './http-validation.js';
import { contentLinkSchema, contentResolveSchema } from './product.schemas.js';

function tenantId(value: string): string {
  const parsed = tenantIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid tenant UUID is required.');
  return parsed.data;
}

@Controller('tenants/:tenantId/content-links')
export class ContentLinkController {
  constructor(@Inject(ContentLinkService) private readonly links: ContentLinkService) {}

  @Put()
  map(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Body() body: unknown,
  ) {
    return this.links.map(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(contentLinkSchema, body),
    );
  }

  @Get('resolve')
  resolve(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Query() query: unknown,
  ) {
    const parsed = parseWithSchema(contentResolveSchema, query);
    return this.links.resolve(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parsed.channel,
      parsed.externalContentId,
    );
  }
}
