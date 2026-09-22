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
  cancelDraftOrderSchema,
  cancelOrderSchema,
  confirmDraftOrderSchema,
  createDraftOrderSchema,
  draftOrderSearchSchema,
  orderEntityIdSchema,
  orderSearchSchema,
  submitDraftOrderSchema,
  transitionOrderSchema,
  updateDraftOrderSchema,
} from './order.schemas.js';
import { OrderService } from './order.service.js';

function tenantId(value: string): string {
  const parsed = tenantIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid tenant UUID is required.');
  return parsed.data;
}

function entityId(value: string): string {
  const parsed = orderEntityIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid UUID is required.');
  return parsed.data;
}

@Controller('tenants/:tenantId')
export class OrderController {
  constructor(@Inject(OrderService) private readonly orders: OrderService) {}

  @Get('draft-orders')
  listDrafts(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Query() query: unknown,
  ) {
    return this.orders.listDrafts(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(draftOrderSearchSchema, query),
    );
  }

  @Post('draft-orders')
  createDraft(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Body() body: unknown,
  ) {
    return this.orders.createDraft(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(createDraftOrderSchema, body),
    );
  }

  @Get('draft-orders/:draftOrderId')
  getDraft(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('draftOrderId') candidateDraftOrderId: string,
  ) {
    return this.orders.getDraft(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateDraftOrderId),
    );
  }

  @Put('draft-orders/:draftOrderId')
  updateDraft(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('draftOrderId') candidateDraftOrderId: string,
    @Body() body: unknown,
  ) {
    return this.orders.updateDraft(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateDraftOrderId),
      parseWithSchema(updateDraftOrderSchema, body),
    );
  }

  @Post('draft-orders/:draftOrderId/submit')
  submitDraft(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('draftOrderId') candidateDraftOrderId: string,
    @Body() body: unknown,
  ) {
    return this.orders.submitDraft(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateDraftOrderId),
      parseWithSchema(submitDraftOrderSchema, body),
    );
  }

  @Post('draft-orders/:draftOrderId/confirm')
  confirmDraft(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('draftOrderId') candidateDraftOrderId: string,
    @Body() body: unknown,
  ) {
    return this.orders.confirmDraft(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateDraftOrderId),
      parseWithSchema(confirmDraftOrderSchema, body),
    );
  }

  @Post('draft-orders/:draftOrderId/cancel')
  cancelDraft(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('draftOrderId') candidateDraftOrderId: string,
    @Body() body: unknown,
  ) {
    return this.orders.cancelDraft(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateDraftOrderId),
      parseWithSchema(cancelDraftOrderSchema, body),
    );
  }

  @Get('orders')
  listOrders(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Query() query: unknown,
  ) {
    return this.orders.listOrders(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(orderSearchSchema, query),
    );
  }

  @Get('orders/by-number/:orderNumber')
  getOrderByNumber(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('orderNumber') orderNumber: string,
  ) {
    return this.orders.getOrderByNumber(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      orderNumber,
    );
  }

  @Get('orders/:orderId')
  getOrder(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('orderId') candidateOrderId: string,
  ) {
    return this.orders.getOrder(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateOrderId),
    );
  }

  @Post('orders/:orderId/transition')
  transition(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('orderId') candidateOrderId: string,
    @Body() body: unknown,
  ) {
    return this.orders.transition(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateOrderId),
      parseWithSchema(transitionOrderSchema, body),
    );
  }

  @Post('orders/:orderId/cancel')
  cancelOrder(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('orderId') candidateOrderId: string,
    @Body() body: unknown,
  ) {
    return this.orders.cancelOrder(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateOrderId),
      parseWithSchema(cancelOrderSchema, body),
    );
  }
}
