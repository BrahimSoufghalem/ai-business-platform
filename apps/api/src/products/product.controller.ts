import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { CorrelationId, CurrentIdentity } from '../auth/request-context.decorator.js';
import { tenantIdSchema } from '../tenants/tenant.schemas.js';
import { parseWithSchema } from './http-validation.js';
import {
  createProductSchema,
  productIdSchema,
  productSearchSchema,
  updateProductSchema,
} from './product.schemas.js';
import { ProductService } from './product.service.js';

function tenantId(value: string): string {
  const parsed = tenantIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid tenant UUID is required.');
  return parsed.data;
}

function productId(value: string): string {
  const parsed = productIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid product UUID is required.');
  return parsed.data;
}

@Controller('tenants/:tenantId/products')
export class ProductController {
  constructor(@Inject(ProductService) private readonly products: ProductService) {}

  @Get()
  search(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Query() query: unknown,
  ) {
    return this.products.search(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(productSearchSchema, query),
    );
  }

  @Post()
  create(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Body() body: unknown,
  ) {
    return this.products.create(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(createProductSchema, body),
    );
  }

  @Get('by-code/:code')
  getByCode(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('code') code: string,
  ) {
    return this.products.getByCode(identity, correlationId, tenantId(candidateTenantId), code);
  }

  @Get(':productId')
  get(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('productId') candidateProductId: string,
  ) {
    return this.products.get(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      productId(candidateProductId),
    );
  }

  @Put(':productId')
  update(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('productId') candidateProductId: string,
    @Body() body: unknown,
  ) {
    return this.products.update(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      productId(candidateProductId),
      parseWithSchema(updateProductSchema, body),
    );
  }

  @Post(':productId/publish')
  publish(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('productId') candidateProductId: string,
  ) {
    return this.products.publish(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      productId(candidateProductId),
    );
  }

  @Delete(':productId')
  @HttpCode(204)
  archive(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('productId') candidateProductId: string,
  ) {
    return this.products.archive(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      productId(candidateProductId),
    );
  }
}
