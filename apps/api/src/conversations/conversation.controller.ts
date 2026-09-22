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
  appendConversationMessageSchema,
  claimConversationSchema,
  conversationEntityIdSchema,
  conversationSearchSchema,
  createConversationSchema,
  transitionConversationSchema,
  updateConversationLinksSchema,
} from './conversation.schemas.js';
import { ConversationService } from './conversation.service.js';

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
export class ConversationController {
  constructor(@Inject(ConversationService) private readonly conversations: ConversationService) {}

  @Get()
  list(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Query() query: unknown,
  ) {
    return this.conversations.list(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(conversationSearchSchema, query),
    );
  }

  @Post()
  create(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Body() body: unknown,
  ) {
    return this.conversations.create(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(createConversationSchema, body),
    );
  }

  @Get(':conversationId')
  get(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('conversationId') candidateConversationId: string,
  ) {
    return this.conversations.get(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      conversationId(candidateConversationId),
    );
  }

  @Post(':conversationId/messages')
  appendMessage(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('conversationId') candidateConversationId: string,
    @Body() body: unknown,
  ) {
    return this.conversations.appendMessage(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      conversationId(candidateConversationId),
      parseWithSchema(appendConversationMessageSchema, body),
    );
  }

  @Post(':conversationId/claim')
  claim(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('conversationId') candidateConversationId: string,
    @Body() body: unknown,
  ) {
    return this.conversations.claim(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      conversationId(candidateConversationId),
      parseWithSchema(claimConversationSchema, body),
    );
  }

  @Post(':conversationId/status')
  transition(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('conversationId') candidateConversationId: string,
    @Body() body: unknown,
  ) {
    return this.conversations.transition(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      conversationId(candidateConversationId),
      parseWithSchema(transitionConversationSchema, body),
    );
  }

  @Put(':conversationId/links')
  updateLinks(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('conversationId') candidateConversationId: string,
    @Body() body: unknown,
  ) {
    return this.conversations.updateLinks(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      conversationId(candidateConversationId),
      parseWithSchema(updateConversationLinksSchema, body),
    );
  }
}
