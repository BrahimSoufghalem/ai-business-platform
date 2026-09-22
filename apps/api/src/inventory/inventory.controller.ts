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
  adjustInventorySchema,
  balanceQuerySchema,
  commitReservationSchema,
  createInventoryLocationSchema,
  inventoryEntityIdSchema,
  movementQuerySchema,
  receiveInventorySchema,
  releaseReservationSchema,
  reservationQuerySchema,
  reserveInventorySchema,
  returnInventorySchema,
  sellInventorySchema,
  setReorderPointSchema,
} from './inventory.schemas.js';
import { InventoryService } from './inventory.service.js';

function tenantId(value: string): string {
  const parsed = tenantIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid tenant UUID is required.');
  return parsed.data;
}

function entityId(value: string): string {
  const parsed = inventoryEntityIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid UUID is required.');
  return parsed.data;
}

@Controller('tenants/:tenantId/inventory')
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  @Get('locations')
  listLocations(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
  ) {
    return this.inventory.listLocations(identity, correlationId, tenantId(candidateTenantId));
  }

  @Post('locations')
  createLocation(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.createLocation(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(createInventoryLocationSchema, body),
    );
  }

  @Get('balances')
  listBalances(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Query() query: unknown,
  ) {
    return this.inventory.listBalances(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(balanceQuerySchema, query),
    );
  }

  @Put('balances/reorder-point')
  setReorderPoint(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.setReorderPoint(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(setReorderPointSchema, body),
    );
  }

  @Get('movements')
  listMovements(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Query() query: unknown,
  ) {
    return this.inventory.listMovements(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(movementQuerySchema, query),
    );
  }

  @Post('receive')
  receive(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.receive(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(receiveInventorySchema, body),
    );
  }

  @Post('adjust')
  adjust(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.adjust(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(adjustInventorySchema, body),
    );
  }

  @Post('sales')
  sell(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.sell(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(sellInventorySchema, body),
    );
  }

  @Post('returns')
  returnStock(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.returnStock(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(returnInventorySchema, body),
    );
  }

  @Get('reservations')
  listReservations(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Query() query: unknown,
  ) {
    return this.inventory.listReservations(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(reservationQuerySchema, query),
    );
  }

  @Post('reservations')
  reserve(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.reserve(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(reserveInventorySchema, body),
    );
  }

  @Post('reservations/:reservationId/release')
  release(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('reservationId') candidateReservationId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.release(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateReservationId),
      parseWithSchema(releaseReservationSchema, body),
    );
  }

  @Post('reservations/:reservationId/commit')
  commit(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('reservationId') candidateReservationId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.commit(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateReservationId),
      parseWithSchema(commitReservationSchema, body),
    );
  }
}
