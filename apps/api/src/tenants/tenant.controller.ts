import { BadRequestException, Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { CorrelationId, CurrentIdentity } from '../auth/request-context.decorator.js';
import { createTenantSchema, tenantIdSchema } from './tenant.schemas.js';
import { TenantService } from './tenant.service.js';

function parseTenantId(value: string): string {
  const parsed = tenantIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid tenant UUID is required.');
  return parsed.data;
}

@Controller('tenants')
export class TenantController {
  constructor(@Inject(TenantService) private readonly tenants: TenantService) {}

  @Get()
  list(@CurrentIdentity() identity: VerifiedIdentity, @CorrelationId() correlationId: string) {
    return this.tenants.list(identity, correlationId);
  }

  @Post()
  create(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Body() body: unknown,
  ) {
    const parsed = createTenantSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid tenant data.',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return this.tenants.create(identity, correlationId, parsed.data);
  }

  @Get(':tenantId/audit-events')
  listAuditEvents(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') tenantId: string,
  ) {
    return this.tenants.listAuditEvents(identity, correlationId, parseTenantId(tenantId));
  }

  @Get(':tenantId')
  get(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') tenantId: string,
  ) {
    return this.tenants.get(identity, correlationId, parseTenantId(tenantId));
  }
}
