import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { CorrelationId, CurrentIdentity } from '../auth/request-context.decorator.js';
import { parseWithSchema } from '../products/http-validation.js';
import { tenantIdSchema } from '../tenants/tenant.schemas.js';
import {
  createCustomerNoteSchema,
  createCustomerSchema,
  customerEntityIdSchema,
  customerSearchSchema,
  updateCustomerSchema,
} from './customer.schemas.js';
import { CustomerService } from './customer.service.js';

function tenantId(value: string): string {
  const parsed = tenantIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid tenant UUID is required.');
  return parsed.data;
}

function customerId(value: string): string {
  const parsed = customerEntityIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid customer UUID is required.');
  return parsed.data;
}

@Controller('tenants/:tenantId/customers')
export class CustomerController {
  constructor(@Inject(CustomerService) private readonly customers: CustomerService) {}

  @Get()
  list(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Query() query: unknown,
  ) {
    return this.customers.list(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(customerSearchSchema, query),
    );
  }

  @Post()
  create(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Body() body: unknown,
  ) {
    return this.customers.create(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(createCustomerSchema, body),
    );
  }

  @Get(':customerId')
  get(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('customerId') candidateCustomerId: string,
  ) {
    return this.customers.get(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      customerId(candidateCustomerId),
    );
  }

  @Put(':customerId')
  update(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('customerId') candidateCustomerId: string,
    @Body() body: unknown,
  ) {
    return this.customers.update(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      customerId(candidateCustomerId),
      parseWithSchema(updateCustomerSchema, body),
    );
  }

  @Post(':customerId/notes')
  addNote(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('customerId') candidateCustomerId: string,
    @Body() body: unknown,
  ) {
    return this.customers.addNote(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      customerId(candidateCustomerId),
      parseWithSchema(createCustomerNoteSchema, body),
    );
  }
}
