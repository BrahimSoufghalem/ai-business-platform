import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Put,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { VerifiedIdentity } from '@ai-business/auth';
import { CorrelationId, CurrentIdentity } from '../auth/request-context.decorator.js';
import { tenantIdSchema } from '../tenants/tenant.schemas.js';
import { connectInstagramAccountSchema } from './instagram-connection.schemas.js';
import {
  InstagramConnectionService,
  type InstagramConnectionView,
} from './instagram-connection.service.js';

function parseTenantId(value: string): string {
  const parsed = tenantIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid tenant UUID is required.');
  return parsed.data;
}

function parseConnection(body: unknown) {
  const parsed = connectInstagramAccountSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({
      message: 'Invalid Instagram connection data.',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

@Controller('tenants/:tenantId/integrations/instagram')
export class InstagramConnectionController {
  constructor(
    @Inject(InstagramConnectionService)
    private readonly connections: InstagramConnectionService,
  ) {}

  @Get()
  async get(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') tenantId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<InstagramConnectionView | undefined> {
    const connection = await this.connections.get(identity, correlationId, parseTenantId(tenantId));
    if (!connection) {
      reply.status(204);
      return undefined;
    }
    return connection;
  }

  @Put()
  connect(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
  ) {
    return this.connections.connect(
      identity,
      correlationId,
      parseTenantId(tenantId),
      parseConnection(body),
    );
  }

  @Delete()
  @HttpCode(204)
  disconnect(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') tenantId: string,
  ) {
    return this.connections.disconnect(identity, correlationId, parseTenantId(tenantId));
  }
}
