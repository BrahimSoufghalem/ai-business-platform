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
} from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { PRODUCT_TYPE_TEMPLATES, validateAttributeDefinitions } from '@ai-business/domain';
import { CorrelationId, CurrentIdentity } from '../auth/request-context.decorator.js';
import { tenantIdSchema } from '../tenants/tenant.schemas.js';
import {
  createProductTypeSchema,
  productTypeIdSchema,
  updateProductTypeSchema,
} from './product-type.schemas.js';
import { ProductTypeService } from './product-type.service.js';

function parseUuid(value: string, label: string): string {
  const parsed = productTypeIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException(`A valid ${label} UUID is required.`);
  return parsed.data;
}

function parseTenantId(value: string): string {
  const parsed = tenantIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid tenant UUID is required.');
  return parsed.data;
}

function parseBody<T>(
  schema: {
    safeParse(
      value: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: readonly { path: PropertyKey[]; message: string }[] } };
  },
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      message: 'Invalid product type data.',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

@Controller('product-type-templates')
export class ProductTypeTemplateController {
  @Get()
  list() {
    return PRODUCT_TYPE_TEMPLATES.map((template) => ({
      ...template,
      attributes: validateAttributeDefinitions(template.attributes),
    }));
  }
}

@Controller('tenants/:tenantId/product-types')
export class ProductTypeController {
  constructor(@Inject(ProductTypeService) private readonly productTypes: ProductTypeService) {}

  @Get()
  list(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') tenantId: string,
  ) {
    return this.productTypes.list(identity, correlationId, parseTenantId(tenantId));
  }

  @Post()
  create(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
  ) {
    return this.productTypes.create(
      identity,
      correlationId,
      parseTenantId(tenantId),
      parseBody(createProductTypeSchema, body),
    );
  }

  @Get(':productTypeId')
  get(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') tenantId: string,
    @Param('productTypeId') productTypeId: string,
  ) {
    return this.productTypes.get(
      identity,
      correlationId,
      parseTenantId(tenantId),
      parseUuid(productTypeId, 'product type'),
    );
  }

  @Put(':productTypeId')
  update(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') tenantId: string,
    @Param('productTypeId') productTypeId: string,
    @Body() body: unknown,
  ) {
    return this.productTypes.update(
      identity,
      correlationId,
      parseTenantId(tenantId),
      parseUuid(productTypeId, 'product type'),
      parseBody(updateProductTypeSchema, body),
    );
  }

  @Delete(':productTypeId')
  @HttpCode(204)
  archive(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') tenantId: string,
    @Param('productTypeId') productTypeId: string,
  ) {
    return this.productTypes.archive(
      identity,
      correlationId,
      parseTenantId(tenantId),
      parseUuid(productTypeId, 'product type'),
    );
  }
}
