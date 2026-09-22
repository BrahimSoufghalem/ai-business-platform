import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import type { AiRunTraceRecord, AiRunTraceSink } from '@ai-business/ai-gateway';
import { CustomerAgentRuntime, type CustomerAgentReply } from '@ai-business/customer-agent';
import { persistAiRunTrace, withTenantTransaction } from '@ai-business/db';
import { AgentSettingsService } from '../configuration/agent-settings.service.js';
import { BusinessRuleService } from '../configuration/business-rule.service.js';
import { KnowledgeService } from '../configuration/knowledge.service.js';
import { ConversationService } from '../conversations/conversation.service.js';
import { DatabaseService } from '../database/database.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ProductService } from '../products/product.service.js';
import { authorizeTenantPermission } from '../tenancy/tenant-authorization.js';
import { createCandidateTenantContext } from '../tenancy/trusted-tenant-context.js';
import { RequestCustomerAgentDataSource } from './customer-agent-data-source.js';
import { createConfiguredCustomerAgentGateway } from './customer-agent.gateway.js';
import {
  storedCustomerAgentReplySchema,
  type CustomerAgentReplyRequest,
} from './customer-agent.schemas.js';

export interface CustomerAgentApiReply extends CustomerAgentReply {
  readonly messageId: string;
  readonly replayed: boolean;
}

class RequestAiTraceSink implements AiRunTraceSink {
  constructor(
    private readonly database: DatabaseService,
    private readonly identity: VerifiedIdentity,
    private readonly tenantId: string,
    private readonly conversationId: string,
    private readonly correlationId: string,
  ) {}

  async record(run: AiRunTraceRecord): Promise<void> {
    if (
      run.tenantId !== this.tenantId ||
      run.conversationId !== this.conversationId ||
      run.correlationId !== this.correlationId
    ) {
      throw new Error('ai_trace_context_mismatch');
    }
    const context = createCandidateTenantContext(this.identity, this.tenantId, this.correlationId);
    await withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'conversations:read');
      await persistAiRunTrace(transaction, run);
    });
  }
}

@Injectable()
export class CustomerAgentService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ConversationService) private readonly conversations: ConversationService,
    @Inject(ProductService) private readonly products: ProductService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(BusinessRuleService) private readonly rules: BusinessRuleService,
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
    @Inject(AgentSettingsService) private readonly settings: AgentSettingsService,
  ) {}

  async reply(
    identity: VerifiedIdentity,
    correlationId: string,
    tenantId: string,
    conversationId: string,
    input: CustomerAgentReplyRequest,
  ): Promise<CustomerAgentApiReply> {
    const conversation = await this.conversations.get(
      identity,
      correlationId,
      tenantId,
      conversationId,
    );
    const customerMessage = conversation.messages.find(
      (message) =>
        message.id === input.messageId &&
        message.direction === 'inbound' &&
        message.senderType === 'customer',
    );
    if (!customerMessage) {
      throw new NotFoundException('Inbound customer message not found.');
    }
    const existing = conversation.messages.find(
      (message) =>
        message.direction === 'outbound' &&
        message.senderType === 'bot' &&
        message.metadata.inReplyToMessageId === input.messageId,
    );
    if (existing) {
      const parsed = storedCustomerAgentReplySchema.safeParse(existing.metadata.agentReply);
      if (!parsed.success) {
        throw new ConflictException('Stored agent reply metadata is invalid.');
      }
      return { ...parsed.data, messageId: existing.id, replayed: true };
    }
    const latestInbound = [...conversation.messages]
      .reverse()
      .find((message) => message.direction === 'inbound' && message.senderType === 'customer');
    if (latestInbound?.id !== input.messageId) {
      throw new ConflictException('Only the latest unanswered customer message can be processed.');
    }
    if (conversation.status !== 'bot') {
      throw new ConflictException('The bot cannot reply while the conversation is human-owned.');
    }

    const dataSource = new RequestCustomerAgentDataSource({
      identity,
      tenantId,
      conversationId,
      correlationId,
      products: this.products,
      inventory: this.inventory,
      rules: this.rules,
      knowledge: this.knowledge,
      settings: this.settings,
    });
    const traceSink = new RequestAiTraceSink(
      this.database,
      identity,
      tenantId,
      conversationId,
      correlationId,
    );
    const runtime = new CustomerAgentRuntime({
      dataSource,
      traceSink,
      createGateway: (factoryInput) => createConfiguredCustomerAgentGateway(factoryInput),
    });
    const agentReply = await runtime.run({
      tenantId,
      correlationId,
      messageId: input.messageId,
      conversation: {
        id: conversation.id,
        status: conversation.status,
        linkedProductId: conversation.productId,
        messages: conversation.messages.map((message) => ({
          id: message.id,
          direction: message.direction,
          senderType: message.senderType,
          content: message.content,
          createdAt: message.createdAt,
        })),
      },
    });
    const message = await this.conversations.appendMessage(
      identity,
      correlationId,
      tenantId,
      conversationId,
      {
        direction: 'outbound',
        senderType: 'bot',
        senderId: 'customer-agent',
        externalId: `agent-reply:${input.messageId}`,
        content: agentReply.text,
        metadata: {
          kind: 'customer_agent_reply',
          inReplyToMessageId: input.messageId,
          agentReply,
        },
      },
    );
    return {
      ...agentReply,
      messageId: message.id,
      replayed: message.replayed ?? false,
    };
  }
}
