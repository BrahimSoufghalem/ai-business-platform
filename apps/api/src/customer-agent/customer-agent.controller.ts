import { BadRequestException, Body, Controller, Inject, Param, Post } from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { CorrelationId, CurrentIdentity } from '../auth/request-context.decorator.js';
import { parseWithSchema } from '../products/http-validation.js';
import { tenantIdSchema } from '../tenants/tenant.schemas.js';
import { conversationEntityIdSchema } from '../conversations/conversation.schemas.js';
import { CustomerAgentService } from './customer-agent.service.js';
import { customerAgentReplyRequestSchema } from './customer-agent.schemas.js';

function tenantId(value: string): string {
  const parsed = tenantIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid tenant UUID is required.');
  return parsed.data;
}

function conversationId(value: string): string {
  const parsed = conversationEntityIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid conversation UUID is required.');
  return parsed.data;
}

@Controller('tenants/:tenantId/conversations')
export class CustomerAgentController {
  constructor(@Inject(CustomerAgentService) private readonly customerAgent: CustomerAgentService) {}

  @Post(':conversationId/agent-reply')
  reply(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('conversationId') candidateConversationId: string,
    @Body() body: unknown,
  ) {
    return this.customerAgent.reply(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      conversationId(candidateConversationId),
      parseWithSchema(customerAgentReplyRequestSchema, body),
    );
  }
}
