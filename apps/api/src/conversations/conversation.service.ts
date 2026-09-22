import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import {
  InvalidConversationTransitionError,
  assertConversationTransition,
  maskCustomerContact,
  type ConversationStatus,
  type CustomerContactType,
} from '@ai-business/domain';
import { withTenantTransaction, type TenantTransaction } from '@ai-business/db';
import { DatabaseService } from '../database/database.service.js';
import { authorizeTenantPermission } from '../tenancy/tenant-authorization.js';
import { createCandidateTenantContext } from '../tenancy/trusted-tenant-context.js';
import type {
  ClaimConversationInput,
  ConversationMessageInput,
  ConversationSearchInput,
  CreateConversationInput,
  TransitionConversationInput,
  UpdateConversationLinksInput,
} from './conversation.schemas.js';

type ConversationChannel = 'internal' | 'instagram' | 'whatsapp' | 'web' | 'email';
type MessageDirection = 'inbound' | 'outbound' | 'internal';
type MessageSenderType = 'customer' | 'agent' | 'bot' | 'system';
type JsonInput = Parameters<TenantTransaction['json']>[0];

export interface ConversationMessageView {
  readonly id: string;
  readonly direction: MessageDirection;
  readonly senderType: MessageSenderType;
  readonly senderId: string | null;
  readonly externalId: string | null;
  readonly content: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly replayed?: boolean;
}

export interface ConversationSummaryView {
  readonly id: string;
  readonly customer: {
    id: string;
    name: string;
    contactHint: string | null;
  };
  readonly channel: ConversationChannel;
  readonly status: ConversationStatus;
  readonly assignedToUserId: string | null;
  readonly assignedToMe: boolean;
  readonly subject: string | null;
  readonly productId: string | null;
  readonly draftOrderId: string | null;
  readonly orderId: string | null;
  readonly version: number;
  readonly lastMessagePreview: string | null;
  readonly lastMessageAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConversationView extends ConversationSummaryView {
  readonly externalThreadId: string | null;
  readonly messages: readonly ConversationMessageView[];
  readonly transitions: readonly {
    id: string;
    fromStatus: ConversationStatus | null;
    toStatus: ConversationStatus;
    actorId: string;
    reason: string | null;
    createdAt: string;
  }[];
}

function jsonInput(value: unknown): JsonInput {
  return value as JsonInput;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function messageFingerprint(input: ConversationMessageInput): string {
  return createHash('sha256')
    .update(
      stableJson({
        direction: input.direction,
        senderType: input.senderType,
        senderId: input.senderId ?? null,
        content: input.content,
        metadata: input.metadata,
      }),
    )
    .digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

@Injectable()
export class ConversationService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private validateMessage(input: ConversationMessageInput): void {
    if (input.direction === 'inbound' && input.senderType !== 'customer') {
      throw new BadRequestException('Inbound messages must be sent by the customer.');
    }
    if (input.direction === 'outbound' && input.senderType === 'customer') {
      throw new BadRequestException('Outbound messages cannot be sent by the customer.');
    }
    if (
      input.direction === 'internal' &&
      input.senderType !== 'agent' &&
      input.senderType !== 'system'
    ) {
      throw new BadRequestException('Internal messages must be sent by an agent or the system.');
    }
  }

  private async currentUserId(transaction: TenantTransaction, tenantId: string): Promise<string> {
    const [user] = await transaction<{ id: string }[]>`
      select app_current_membership_user_id(${tenantId})::text as id
    `;
    if (!user?.id) throw new NotFoundException('Active tenant member not found.');
    return user.id;
  }

  private async validateLinks(
    transaction: TenantTransaction,
    tenantId: string,
    input: {
      customerId: string;
      productId?: string | null | undefined;
      draftOrderId?: string | null | undefined;
      orderId?: string | null | undefined;
    },
  ): Promise<void> {
    const [customer] = await transaction<{ id: string }[]>`
      select id::text from customers
      where tenant_id = ${tenantId} and id = ${input.customerId} and status = 'active'
      limit 1
    `;
    if (!customer) throw new NotFoundException('Active customer not found.');
    if (input.productId) {
      const [product] = await transaction<{ id: string }[]>`
        select id::text from products
        where tenant_id = ${tenantId} and id = ${input.productId}
        limit 1
      `;
      if (!product) throw new NotFoundException('Linked product not found.');
    }
    if (input.draftOrderId) {
      const [draft] = await transaction<{ id: string }[]>`
        select id::text from draft_orders
        where tenant_id = ${tenantId} and id = ${input.draftOrderId}
        limit 1
      `;
      if (!draft) throw new NotFoundException('Linked draft order not found.');
    }
    if (input.orderId) {
      const [order] = await transaction<{ id: string }[]>`
        select id::text from orders
        where tenant_id = ${tenantId} and id = ${input.orderId}
        limit 1
      `;
      if (!order) throw new NotFoundException('Linked order not found.');
    }
  }

  private async appendMessageInTransaction(
    transaction: TenantTransaction,
    identity: VerifiedIdentity,
    tenantId: string,
    conversationId: string,
    input: ConversationMessageInput,
  ): Promise<ConversationMessageView> {
    this.validateMessage(input);
    const fingerprint = messageFingerprint(input);
    if (input.externalId) {
      await transaction`
        select pg_advisory_xact_lock(
          hashtextextended(
            ${`${tenantId}:message:${conversationId}:${input.externalId}`},
            0::bigint
          )
        )
      `;
      const [existing] = await transaction<
        {
          id: string;
          direction: MessageDirection;
          senderType: MessageSenderType;
          senderId: string | null;
          externalId: string | null;
          fingerprint: string;
          content: string;
          metadata: Record<string, unknown>;
          createdAt: Date;
        }[]
      >`
        select
          id::text, direction::text, sender_type::text as "senderType",
          sender_id as "senderId", external_id as "externalId", fingerprint,
          content, metadata, created_at as "createdAt"
        from messages
        where tenant_id = ${tenantId}
          and conversation_id = ${conversationId}
          and external_id = ${input.externalId}
        limit 1
      `;
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new ConflictException(
            'The external message ID was already used with different content.',
          );
        }
        const { fingerprint: _fingerprint, ...message } = existing;
        void _fingerprint;
        return { ...message, createdAt: message.createdAt.toISOString(), replayed: true };
      }
    }
    const senderId =
      input.senderId ??
      (input.senderType === 'agent' || input.senderType === 'bot' ? identity.subject : null);
    const [created] = await transaction<
      {
        id: string;
        direction: MessageDirection;
        senderType: MessageSenderType;
        senderId: string | null;
        externalId: string | null;
        content: string;
        metadata: Record<string, unknown>;
        createdAt: Date;
      }[]
    >`
      insert into messages (
        tenant_id, conversation_id, direction, sender_type, sender_id,
        external_id, fingerprint, content, metadata
      ) values (
        ${tenantId}, ${conversationId}, ${input.direction}, ${input.senderType},
        ${senderId}, ${input.externalId ?? null}, ${fingerprint}, ${input.content},
        ${transaction.json(jsonInput(input.metadata))}
      )
      returning
        id::text, direction::text, sender_type::text as "senderType",
        sender_id as "senderId", external_id as "externalId", content, metadata,
        created_at as "createdAt"
    `;
    if (!created) throw new Error('Message insert returned no row.');
    await transaction`
      update conversations
      set last_message_at = ${created.createdAt}, updated_at = now()
      where tenant_id = ${tenantId} and id = ${conversationId}
    `;
    return { ...created, createdAt: created.createdAt.toISOString(), replayed: false };
  }

  private async loadSummary(
    transaction: TenantTransaction,
    tenantId: string,
    conversationId: string,
    currentUserId: string,
  ): Promise<ConversationSummaryView | null> {
    const [row] = await transaction<
      {
        id: string;
        customerId: string;
        customerName: string;
        contactType: CustomerContactType | null;
        normalizedContact: string | null;
        channel: ConversationChannel;
        status: ConversationStatus;
        assignedToUserId: string | null;
        subject: string | null;
        productId: string | null;
        draftOrderId: string | null;
        orderId: string | null;
        version: number;
        lastMessagePreview: string | null;
        lastMessageAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
      }[]
    >`
      select
        conversation.id::text,
        conversation.customer_id::text as "customerId",
        customer.name as "customerName",
        contact.type::text as "contactType",
        contact.normalized_value as "normalizedContact",
        conversation.channel::text, conversation.status::text,
        conversation.assigned_to_user_id::text as "assignedToUserId",
        conversation.subject, conversation.product_id::text as "productId",
        conversation.draft_order_id::text as "draftOrderId",
        conversation.order_id::text as "orderId", conversation.version,
        left(last_message.content, 180) as "lastMessagePreview",
        conversation.last_message_at as "lastMessageAt",
        conversation.created_at as "createdAt",
        conversation.updated_at as "updatedAt"
      from conversations as conversation
      join customers as customer
        on customer.tenant_id = conversation.tenant_id
        and customer.id = conversation.customer_id
      left join lateral (
        select type, normalized_value
        from customer_contacts
        where tenant_id = conversation.tenant_id
          and customer_id = conversation.customer_id
        order by is_primary desc, created_at, id
        limit 1
      ) as contact on true
      left join lateral (
        select content
        from messages
        where tenant_id = conversation.tenant_id
          and conversation_id = conversation.id
        order by created_at desc, id desc
        limit 1
      ) as last_message on true
      where conversation.tenant_id = ${tenantId}
        and conversation.id = ${conversationId}
      limit 1
    `;
    if (!row) return null;
    return {
      id: row.id,
      customer: {
        id: row.customerId,
        name: row.customerName,
        contactHint:
          row.contactType && row.normalizedContact
            ? maskCustomerContact(row.contactType, row.normalizedContact)
            : null,
      },
      channel: row.channel,
      status: row.status,
      assignedToUserId: row.assignedToUserId,
      assignedToMe: row.assignedToUserId === currentUserId,
      subject: row.subject,
      productId: row.productId,
      draftOrderId: row.draftOrderId,
      orderId: row.orderId,
      version: row.version,
      lastMessagePreview: row.lastMessagePreview,
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async loadConversation(
    transaction: TenantTransaction,
    tenantId: string,
    conversationId: string,
    currentUserId: string,
  ): Promise<ConversationView | null> {
    const summary = await this.loadSummary(transaction, tenantId, conversationId, currentUserId);
    if (!summary) return null;
    const [core] = await transaction<{ externalThreadId: string | null }[]>`
      select external_thread_id as "externalThreadId"
      from conversations
      where tenant_id = ${tenantId} and id = ${conversationId}
      limit 1
    `;
    if (!core) return null;
    const messageRows = await transaction<
      {
        id: string;
        direction: MessageDirection;
        senderType: MessageSenderType;
        senderId: string | null;
        externalId: string | null;
        content: string;
        metadata: Record<string, unknown>;
        createdAt: Date;
      }[]
    >`
      select
        id::text, direction::text, sender_type::text as "senderType",
        sender_id as "senderId", external_id as "externalId", content, metadata,
        created_at as "createdAt"
      from messages
      where tenant_id = ${tenantId} and conversation_id = ${conversationId}
      order by created_at, id
      limit 500
    `;
    const transitionRows = await transaction<
      {
        id: string;
        fromStatus: ConversationStatus | null;
        toStatus: ConversationStatus;
        actorId: string;
        reason: string | null;
        createdAt: Date;
      }[]
    >`
      select
        id::text, from_status::text as "fromStatus", to_status::text as "toStatus",
        actor_id as "actorId", reason, created_at as "createdAt"
      from conversation_transitions
      where tenant_id = ${tenantId} and conversation_id = ${conversationId}
      order by created_at, id
    `;
    return {
      ...summary,
      externalThreadId: core.externalThreadId,
      messages: messageRows.map((message) => ({
        ...message,
        createdAt: message.createdAt.toISOString(),
      })),
      transitions: transitionRows.map((transition) => ({
        ...transition,
        createdAt: transition.createdAt.toISOString(),
      })),
    };
  }

  async create(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: CreateConversationInput,
  ): Promise<ConversationView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    try {
      return await withTenantTransaction(this.database.client, context, async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'conversations:manage');
        const currentUserId = await this.currentUserId(transaction, context.tenantId);
        await this.validateLinks(transaction, context.tenantId, input);
        if (input.externalThreadId) {
          await transaction`
            select pg_advisory_xact_lock(
              hashtextextended(
                ${`${context.tenantId}:conversation:${input.channel}:${input.externalThreadId}`},
                0::bigint
              )
            )
          `;
          const [existing] = await transaction<{ id: string; customerId: string }[]>`
            select id::text, customer_id::text as "customerId"
            from conversations
            where tenant_id = ${context.tenantId}
              and channel = ${input.channel}::conversation_channel
              and external_thread_id = ${input.externalThreadId}
            limit 1
          `;
          if (existing) {
            if (existing.customerId !== input.customerId) {
              throw new ConflictException(
                'The external thread is already linked to another customer.',
              );
            }
            if (input.initialMessage) {
              await this.appendMessageInTransaction(
                transaction,
                identity,
                context.tenantId,
                existing.id,
                input.initialMessage,
              );
            }
            const conversation = await this.loadConversation(
              transaction,
              context.tenantId,
              existing.id,
              currentUserId,
            );
            if (!conversation) throw new Error('Existing conversation could not be loaded.');
            return conversation;
          }
        }
        const assignedToUserId = input.status === 'human' ? currentUserId : null;
        const [created] = await transaction<{ id: string }[]>`
          insert into conversations (
            tenant_id, customer_id, channel, external_thread_id, status,
            assigned_to_user_id, subject, product_id, draft_order_id, order_id
          ) values (
            ${context.tenantId}, ${input.customerId}, ${input.channel},
            ${input.externalThreadId ?? null}, ${input.status}, ${assignedToUserId},
            ${input.subject ?? null}, ${input.productId ?? null},
            ${input.draftOrderId ?? null}, ${input.orderId ?? null}
          )
          returning id::text
        `;
        if (!created) throw new Error('Conversation insert returned no ID.');
        await transaction`
          insert into conversation_transitions (
            tenant_id, conversation_id, from_status, to_status, actor_id
          ) values (
            ${context.tenantId}, ${created.id}, null, ${input.status}, ${identity.subject}
          )
        `;
        if (input.initialMessage) {
          await this.appendMessageInTransaction(
            transaction,
            identity,
            context.tenantId,
            created.id,
            input.initialMessage,
          );
        }
        await transaction`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action, entity_type,
            entity_id, correlation_id, metadata
          ) values (
            ${context.tenantId}, 'user', ${identity.subject}, 'conversation.created',
            'conversation', ${created.id}, ${correlationId},
            ${transaction.json({
              channel: input.channel,
              customerId: input.customerId,
              status: input.status,
              hasInitialMessage: input.initialMessage !== undefined,
            })}
          )
        `;
        const conversation = await this.loadConversation(
          transaction,
          context.tenantId,
          created.id,
          currentUserId,
        );
        if (!conversation) throw new Error('Created conversation could not be loaded.');
        return conversation;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('The external conversation identifier already exists.');
      }
      throw error;
    }
  }

  async list(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: ConversationSearchInput,
  ): Promise<ConversationSummaryView[]> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'conversations:read');
      const currentUserId = await this.currentUserId(transaction, context.tenantId);
      const pattern = `%${input.q}%`;
      const ids = await transaction<{ id: string }[]>`
        select conversation.id::text
        from conversations as conversation
        join customers as customer
          on customer.tenant_id = conversation.tenant_id
          and customer.id = conversation.customer_id
        where conversation.tenant_id = ${context.tenantId}
          and (
            ${input.status ?? null}::conversation_status is null
            or conversation.status = ${input.status ?? null}::conversation_status
          )
          and (
            ${input.channel ?? null}::conversation_channel is null
            or conversation.channel = ${input.channel ?? null}::conversation_channel
          )
          and (
            ${input.assignment} = 'all'
            or (${input.assignment} = 'mine' and conversation.assigned_to_user_id = ${currentUserId})
            or (${input.assignment} = 'unassigned' and conversation.assigned_to_user_id is null)
          )
          and (
            ${input.q} = ''
            or customer.name ilike ${pattern}
            or conversation.subject ilike ${pattern}
            or exists (
              select 1 from messages
              where tenant_id = conversation.tenant_id
                and conversation_id = conversation.id
                and content ilike ${pattern}
            )
          )
        order by
          case conversation.status
            when 'needs_human' then 0
            when 'human' then 1
            when 'bot' then 2
            else 3
          end,
          coalesce(conversation.last_message_at, conversation.created_at) desc,
          conversation.id
        limit ${input.limit}
      `;
      const conversations: ConversationSummaryView[] = [];
      for (const { id } of ids) {
        const conversation = await this.loadSummary(
          transaction,
          context.tenantId,
          id,
          currentUserId,
        );
        if (conversation) conversations.push(conversation);
      }
      return conversations;
    });
  }

  async get(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    conversationId: string,
  ): Promise<ConversationView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'conversations:read');
      const currentUserId = await this.currentUserId(transaction, context.tenantId);
      const conversation = await this.loadConversation(
        transaction,
        context.tenantId,
        conversationId,
        currentUserId,
      );
      if (!conversation) throw new NotFoundException('Conversation not found.');
      return conversation;
    });
  }

  async appendMessage(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    conversationId: string,
    input: ConversationMessageInput,
  ): Promise<ConversationMessageView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    try {
      return await withTenantTransaction(this.database.client, context, async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'conversations:manage');
        const [conversation] = await transaction<{ id: string }[]>`
          select id::text from conversations
          where tenant_id = ${context.tenantId} and id = ${conversationId}
          limit 1
        `;
        if (!conversation) throw new NotFoundException('Conversation not found.');
        const message = await this.appendMessageInTransaction(
          transaction,
          identity,
          context.tenantId,
          conversationId,
          input,
        );
        if (!message.replayed) {
          await transaction`
            insert into audit_events (
              tenant_id, actor_type, actor_id, action, entity_type,
              entity_id, correlation_id, metadata
            ) values (
              ${context.tenantId}, 'user', ${identity.subject}, 'conversation.message.created',
              'message', ${message.id}, ${correlationId},
              ${transaction.json({
                conversationId,
                direction: message.direction,
                senderType: message.senderType,
                hasExternalId: message.externalId !== null,
              })}
            )
          `;
        }
        return message;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('The external message identifier already exists.');
      }
      throw error;
    }
  }

  async claim(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    conversationId: string,
    input: ClaimConversationInput,
  ): Promise<ConversationView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'conversations:manage');
      const currentUserId = await this.currentUserId(transaction, context.tenantId);
      const [current] = await transaction<
        { status: ConversationStatus; assignedToUserId: string | null; version: number }[]
      >`
        select
          status::text, assigned_to_user_id::text as "assignedToUserId", version
        from conversations
        where tenant_id = ${context.tenantId} and id = ${conversationId}
        limit 1
        for update
      `;
      if (!current) throw new NotFoundException('Conversation not found.');
      if (current.version !== input.expectedVersion) {
        throw new ConflictException({
          message: 'Conversation changed; reload before claiming.',
          currentVersion: current.version,
        });
      }
      if (current.assignedToUserId && current.assignedToUserId !== currentUserId) {
        throw new ConflictException('Conversation is already assigned to another member.');
      }
      if (current.status !== 'human') {
        try {
          assertConversationTransition(current.status, 'human');
        } catch (error) {
          if (error instanceof InvalidConversationTransitionError) {
            throw new ConflictException(error.message);
          }
          throw error;
        }
        await transaction`
          update conversations
          set
            status = 'human', assigned_to_user_id = ${currentUserId},
            version = version + 1, closed_at = null, updated_at = now()
          where tenant_id = ${context.tenantId} and id = ${conversationId}
        `;
        await transaction`
          insert into conversation_transitions (
            tenant_id, conversation_id, from_status, to_status, actor_id, reason
          ) values (
            ${context.tenantId}, ${conversationId}, ${current.status}, 'human',
            ${identity.subject}, 'Claimed by agent'
          )
        `;
        await this.auditTransition(
          transaction,
          identity,
          context.tenantId,
          correlationId,
          conversationId,
          current.status,
          'human',
        );
      }
      const result = await this.loadConversation(
        transaction,
        context.tenantId,
        conversationId,
        currentUserId,
      );
      if (!result) throw new Error('Claimed conversation could not be loaded.');
      return result;
    });
  }

  private async auditTransition(
    transaction: TenantTransaction,
    identity: VerifiedIdentity,
    tenantId: string,
    correlationId: string,
    conversationId: string,
    fromStatus: ConversationStatus,
    toStatus: ConversationStatus,
  ): Promise<void> {
    await transaction`
      insert into audit_events (
        tenant_id, actor_type, actor_id, action, entity_type,
        entity_id, correlation_id, metadata
      ) values (
        ${tenantId}, 'user', ${identity.subject}, 'conversation.status.changed',
        'conversation', ${conversationId}, ${correlationId},
        ${transaction.json({ fromStatus, toStatus })}
      )
    `;
  }

  async transition(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    conversationId: string,
    input: TransitionConversationInput,
  ): Promise<ConversationView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'conversations:manage');
      const currentUserId = await this.currentUserId(transaction, context.tenantId);
      const [current] = await transaction<
        { status: ConversationStatus; assignedToUserId: string | null; version: number }[]
      >`
        select
          status::text, assigned_to_user_id::text as "assignedToUserId", version
        from conversations
        where tenant_id = ${context.tenantId} and id = ${conversationId}
        limit 1
        for update
      `;
      if (!current) throw new NotFoundException('Conversation not found.');
      if (current.version !== input.expectedVersion) {
        throw new ConflictException({
          message: 'Conversation changed; reload before changing its status.',
          currentVersion: current.version,
        });
      }
      try {
        assertConversationTransition(current.status, input.targetStatus);
      } catch (error) {
        if (error instanceof InvalidConversationTransitionError) {
          throw new ConflictException(error.message);
        }
        throw error;
      }
      if (
        input.targetStatus === 'human' &&
        current.assignedToUserId &&
        current.assignedToUserId !== currentUserId
      ) {
        throw new ConflictException('Conversation is assigned to another member.');
      }
      const assignee = input.targetStatus === 'human' ? currentUserId : null;
      await transaction`
        update conversations
        set
          status = ${input.targetStatus}, assigned_to_user_id = ${assignee},
          version = version + 1,
          closed_at = case when ${input.targetStatus} = 'closed' then now() else null end,
          updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${conversationId}
      `;
      await transaction`
        insert into conversation_transitions (
          tenant_id, conversation_id, from_status, to_status, actor_id, reason
        ) values (
          ${context.tenantId}, ${conversationId}, ${current.status},
          ${input.targetStatus}, ${identity.subject}, ${input.reason ?? null}
        )
      `;
      await this.auditTransition(
        transaction,
        identity,
        context.tenantId,
        correlationId,
        conversationId,
        current.status,
        input.targetStatus,
      );
      const result = await this.loadConversation(
        transaction,
        context.tenantId,
        conversationId,
        currentUserId,
      );
      if (!result) throw new Error('Transitioned conversation could not be loaded.');
      return result;
    });
  }

  async updateLinks(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    conversationId: string,
    input: UpdateConversationLinksInput,
  ): Promise<ConversationView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'conversations:manage');
      const currentUserId = await this.currentUserId(transaction, context.tenantId);
      const [current] = await transaction<
        {
          customerId: string;
          productId: string | null;
          draftOrderId: string | null;
          orderId: string | null;
          subject: string | null;
          version: number;
        }[]
      >`
        select
          customer_id::text as "customerId", product_id::text as "productId",
          draft_order_id::text as "draftOrderId", order_id::text as "orderId",
          subject, version
        from conversations
        where tenant_id = ${context.tenantId} and id = ${conversationId}
        limit 1
        for update
      `;
      if (!current) throw new NotFoundException('Conversation not found.');
      if (current.version !== input.expectedVersion) {
        throw new ConflictException({
          message: 'Conversation changed; reload before linking records.',
          currentVersion: current.version,
        });
      }
      const next = {
        customerId: input.customerId ?? current.customerId,
        productId: input.productId === undefined ? current.productId : input.productId,
        draftOrderId: input.draftOrderId === undefined ? current.draftOrderId : input.draftOrderId,
        orderId: input.orderId === undefined ? current.orderId : input.orderId,
      };
      await this.validateLinks(transaction, context.tenantId, next);
      await transaction`
        update conversations
        set
          customer_id = ${next.customerId}, product_id = ${next.productId},
          draft_order_id = ${next.draftOrderId}, order_id = ${next.orderId},
          subject = ${input.subject === undefined ? current.subject : input.subject},
          version = version + 1, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${conversationId}
      `;
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type,
          entity_id, correlation_id, metadata
        ) values (
          ${context.tenantId}, 'user', ${identity.subject}, 'conversation.links.updated',
          'conversation', ${conversationId}, ${correlationId},
          ${transaction.json({
            customerId: next.customerId,
            productId: next.productId,
            draftOrderId: next.draftOrderId,
            orderId: next.orderId,
          })}
        )
      `;
      const result = await this.loadConversation(
        transaction,
        context.tenantId,
        conversationId,
        currentUserId,
      );
      if (!result) throw new Error('Updated conversation could not be loaded.');
      return result;
    });
  }
}
