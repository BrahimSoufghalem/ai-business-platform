import { BadRequestException, Controller, Get, Inject, Param, Query } from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { CorrelationId, CurrentIdentity } from '../auth/request-context.decorator.js';
import { parseWithSchema } from '../products/http-validation.js';
import { tenantIdSchema } from '../tenants/tenant.schemas.js';
import {
  alertQuerySchema,
  dashboardQuerySchema,
  traceCorrelationIdSchema,
} from './operations.schemas.js';
import { OperationsService } from './operations.service.js';

function tenantId(value: string): string {
  const parsed = tenantIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid tenant UUID is required.');
  return parsed.data;
}

function traceId(value: string): string {
  const parsed = traceCorrelationIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid correlation ID is required.');
  return parsed.data;
}

@Controller('tenants/:tenantId/operations')
export class OperationsController {
  constructor(@Inject(OperationsService) private readonly operations: OperationsService) {}

  @Get('dashboard')
  dashboard(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Query() query: unknown,
  ) {
    return this.operations.getDashboard(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(dashboardQuerySchema, query),
    );
  }

  @Get('alerts')
  alerts(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Query() query: unknown,
  ) {
    return this.operations.listAlerts(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(alertQuerySchema, query),
    );
  }

  @Get('traces/:traceCorrelationId')
  trace(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() requestCorrelationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('traceCorrelationId') candidateTraceCorrelationId: string,
  ) {
    return this.operations.getTrace(
      identity,
      requestCorrelationId,
      tenantId(candidateTenantId),
      traceId(candidateTraceCorrelationId),
    );
  }
}
