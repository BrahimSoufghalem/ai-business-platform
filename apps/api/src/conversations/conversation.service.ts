import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { redactAiTelemetry, type AiIntent } from '@ai-business/ai-gateway';
import type { CustomerAgentReply } from '@ai-business/customer-agent';
import {
  type HandoffReasonCode,
  type HandoffResolutionCode,
  type HandoffStatus,
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
  ReleaseConversationInput,
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

export interface HandoffContextSummary {
  readonly schemaVersion: 1;
  readonly intent: AiIntent;
  readonly reason: HandoffReasonCode;
  readonly customerRequest: string;
  readonly customer: {
    readonly name: string;
    readonly contactHint: string | null;
  };
  readonly product: {
    readonly id: string;
    readonly name: string;
  } | null;
  readonly collectedData: {
    readonly draftOrderId: string | null;
    readonly draftStatus: string | null;
    readonly hasCustomerPhone: boolean;
    readonly hasShippingAddress: boolean;
    readonly itemCount: number;
    readonly orderId: string | null;
    readonly orderNumber: string | null;
  };
}

export interface HandoffView {
  readonly id: string;
  readonly reason: HandoffReasonCode;
  readonly status: HandoffStatus;
  readonly resolution: HandoffResolutionCode | null;
  readonly intent: AiIntent;
  readonly summary: HandoffContextSummary;
  readonly sourceMessageId: string;
  readonly sourceRunId: string;
  readonly customerNoticeMessageId: string | null;
  readonly assignedToUserId: string | null;
  readonly assignedToMe: boolean;
  readonly version: number;
  readonly requestedAt: string;
  readonly firstClaimedAt: string | null;
  readonly claimedAt: string | null;
  readonly releasedAt: string | null;
  readonly resolvedAt: string | null;
  readonly currentWaitSeconds: number;
  readonly firstResponseSeconds: number | null;
  readonly resolutionSeconds: number | null;
}

export interface HandoffMetricsView {
  readonly pending: number;
  readonly active: number;
  readonly resolved: number;
  readonly averageFirstResponseSeconds: number | null;
  readonly averageResolutionSeconds: number | null;
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
  readonly activeHandoff: HandoffView | null;
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
  readonly handoffs: readonly HandoffView[];
  readonly transitions: readonly {
    id: string;
    fromStatus: ConversationStatus | null;
    toStatus: ConversationStatus;
    actorId: string;
    reason: string | null;
    createdAt: string;
  }[];
}

interface HandoffRow {
  readonly id: string;
  readonly reason: HandoffReasonCode;
  readonly status: HandoffStatus;
  readonly resolution: HandoffResolutionCode | null;
  readonly intent: AiIntent;
  readonly summary: HandoffContextSummary;
  readonly sourceMessageId: string;
  readonly sourceRunId: string;
  readonly customerNoticeMessageId: string | null;
  readonly assignedToUserId: string | null;
  readonly version: number;
  readonly requestedAt: Date;
  readonly firstClaimedAt: Date | null;
  readonly claimedAt: Date | null;
  readonly releasedAt: Date | null;
  readonly resolvedAt: Date | null;
  readonly currentWaitSeconds: number;
  readonly firstResponseSeconds: number | null;
  readonly resolutionSeconds: number | null;
}

export interface RequestHandoffInput {
  readonly sourceMessageId: string;
  readonly sourceRunId: string;
  readonly reason: HandoffReasonCode;
  readonly intent: AiIntent;
  readonly customerNotice: string;
  readonly idempotencyKey: string;
  readonly agentReply: CustomerAgentReply;
}

export interface RequestHandoffResult {
  readonly handoff: HandoffView;
  readonly customerMessage: ConversationMessageView;
  readonly agentReply: CustomerAgentReply;
  readonly toolCallId: string;
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

function boundedSummaryText(value: string): string {
  const redacted = redactAiTelemetry(value);
  const safe = typeof redacted === 'string' ? redacted : '[redacted]';
  return safe.replace(/\s+/gu, ' ').trim().slice(0, 500);
}

function mapHandoff(row: HandoffRow, currentUserId: string): HandoffView {
  return {
    ...row,
    assignedToMe: row.assignedToUserId === currentUserId,
    requestedAt: row.requestedAt.toISOString(),
    firstClaimedAt: row.firstClaimedAt?.toISOString() ?? null,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    releasedAt: row.releasedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
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
      input.direction === 'outbound' &&
      input.senderType !== 'agent' &&
      input.senderType !== 'bot'
    ) {
      throw new BadRequestException('Outbound messages must be sent by the bot or an agent.');
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

  private async assertMessageWriteAllowed(
    transaction: TenantTransaction,
    tenantId: string,
    conversationId: string,
    input: ConversationMessageInput,
  ): Promise<void> {
    if (input.direction !== 'outbound') return;
    const [conversation] = await transaction<
      {
        status: ConversationStatus;
        assignedToUserId: string | null;
      }[]
    >`
      select
        status::text,
        assigned_to_user_id::text as "assignedToUserId"
      from conversations
      where tenant_id = ${tenantId} and id = ${conversationId}
      limit 1
    `;
    if (!conversation) throw new NotFoundException('Conversation not found.');
    if (input.senderType === 'bot' && conversation.status !== 'bot') {
      throw new ConflictException('The bot cannot reply while a human handoff is active.');
    }
    if (input.senderType === 'agent') {
      const currentUserId = await this.currentUserId(transaction, tenantId);
      if (conversation.status !== 'human' || conversation.assignedToUserId !== currentUserId) {
        throw new ConflictException(
          'An agent must claim the conversation before sending a customer reply.',
        );
      }
    }
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
    await this.assertMessageWriteAllowed(transaction, tenantId, conversationId, input);
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
        handoffId: string | null;
        handoffReason: HandoffReasonCode | null;
        handoffStatus: HandoffStatus | null;
        handoffResolution: HandoffResolutionCode | null;
        handoffIntent: AiIntent | null;
        handoffSummary: HandoffContextSummary | null;
        handoffSourceMessageId: string | null;
        handoffSourceRunId: string | null;
        handoffCustomerNoticeMessageId: string | null;
        handoffAssignedToUserId: string | null;
        handoffVersion: number | null;
        handoffRequestedAt: Date | null;
        handoffFirstClaimedAt: Date | null;
        handoffClaimedAt: Date | null;
        handoffReleasedAt: Date | null;
        handoffResolvedAt: Date | null;
        handoffCurrentWaitSeconds: number | null;
        handoffFirstResponseSeconds: number | null;
        handoffResolutionSeconds: number | null;
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
        active_handoff.id::text as "handoffId",
        active_handoff.reason::text as "handoffReason",
        active_handoff.status::text as "handoffStatus",
        active_handoff.resolution::text as "handoffResolution",
        active_handoff.intent::text as "handoffIntent",
        active_handoff.summary as "handoffSummary",
        active_handoff.source_message_id::text as "handoffSourceMessageId",
        active_handoff.source_run_id::text as "handoffSourceRunId",
        active_handoff.customer_notice_message_id::text as "handoffCustomerNoticeMessageId",
        active_handoff.assigned_to_user_id::text as "handoffAssignedToUserId",
        active_handoff.version as "handoffVersion",
        active_handoff.requested_at as "handoffRequestedAt",
        active_handoff.first_claimed_at as "handoffFirstClaimedAt",
        active_handoff.claimed_at as "handoffClaimedAt",
        active_handoff.released_at as "handoffReleasedAt",
        active_handoff.resolved_at as "handoffResolvedAt",
        case
          when active_handoff.status = 'pending'
          then greatest(
            0,
            floor(extract(epoch from (
              now() - coalesce(active_handoff.released_at, active_handoff.requested_at)
            )))
          )::int
          else 0
        end as "handoffCurrentWaitSeconds",
        case
          when active_handoff.first_claimed_at is not null
          then greatest(
            0,
            floor(extract(epoch from (
              active_handoff.first_claimed_at - active_handoff.requested_at
            )))
          )::int
          else null
        end as "handoffFirstResponseSeconds",
        null::int as "handoffResolutionSeconds",
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
      left join lateral (
        select handoff.*
        from handoffs as handoff
        where handoff.tenant_id = conversation.tenant_id
          and handoff.conversation_id = conversation.id
          and handoff.status in ('pending', 'active')
        order by handoff.requested_at desc, handoff.id desc
        limit 1
      ) as active_handoff on true
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
      activeHandoff:
        row.handoffId &&
        row.handoffReason &&
        row.handoffStatus &&
        row.handoffIntent &&
        row.handoffSummary &&
        row.handoffSourceMessageId &&
        row.handoffSourceRunId &&
        row.handoffVersion !== null &&
        row.handoffRequestedAt
          ? mapHandoff(
              {
                id: row.handoffId,
                reason: row.handoffReason,
                status: row.handoffStatus,
                resolution: row.handoffResolution,
                intent: row.handoffIntent,
                summary: row.handoffSummary,
                sourceMessageId: row.handoffSourceMessageId,
                sourceRunId: row.handoffSourceRunId,
                customerNoticeMessageId: row.handoffCustomerNoticeMessageId,
                assignedToUserId: row.handoffAssignedToUserId,
                version: row.handoffVersion,
                requestedAt: row.handoffRequestedAt,
                firstClaimedAt: row.handoffFirstClaimedAt,
                claimedAt: row.handoffClaimedAt,
                releasedAt: row.handoffReleasedAt,
                resolvedAt: row.handoffResolvedAt,
                currentWaitSeconds: row.handoffCurrentWaitSeconds ?? 0,
                firstResponseSeconds: row.handoffFirstResponseSeconds,
                resolutionSeconds: row.handoffResolutionSeconds,
              },
              currentUserId,
            )
          : null,
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

  private async loadHandoffs(
    transaction: TenantTransaction,
    tenantId: string,
    conversationId: string,
    currentUserId: string,
  ): Promise<HandoffView[]> {
    const rows = await transaction<HandoffRow[]>`
      select
        id::text, reason::text, status::text, resolution::text,
        intent::text, summary,
        source_message_id::text as "sourceMessageId",
        source_run_id::text as "sourceRunId",
        customer_notice_message_id::text as "customerNoticeMessageId",
        assigned_to_user_id::text as "assignedToUserId",
        version, requested_at as "requestedAt",
        first_claimed_at as "firstClaimedAt",
        claimed_at as "claimedAt", released_at as "releasedAt",
        resolved_at as "resolvedAt",
        case
          when status = 'pending'
          then greatest(
            0,
            floor(extract(epoch from (now() - coalesce(released_at, requested_at))))
          )::int
          else 0
        end as "currentWaitSeconds",
        case
          when first_claimed_at is not null
          then greatest(
            0,
            floor(extract(epoch from (first_claimed_at - requested_at)))
          )::int
          else null
        end as "firstResponseSeconds",
        case
          when resolved_at is not null
          then greatest(
            0,
            floor(extract(epoch from (resolved_at - requested_at)))
          )::int
          else null
        end as "resolutionSeconds"
      from handoffs
      where tenant_id = ${tenantId} and conversation_id = ${conversationId}
      order by requested_at desc, id desc
      limit 100
    `;
    return rows.map((row) => mapHandoff(row, currentUserId));
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
    const handoffs = await this.loadHandoffs(transaction, tenantId, conversationId, currentUserId);
    return {
      ...summary,
      externalThreadId: core.externalThreadId,
      messages: messageRows.map((message) => ({
        ...message,
        createdAt: message.createdAt.toISOString(),
      })),
      handoffs,
      transitions: transitionRows.map((transition) => ({
        ...transition,
        createdAt: transition.createdAt.toISOString(),
      })),
    };
  }

  private async buildHandoffSummary(
    transaction: TenantTransaction,
    tenantId: string,
    conversationId: string,
    sourceMessageId: string,
    intent: AiIntent,
    reason: HandoffReasonCode,
  ): Promise<HandoffContextSummary> {
    const [row] = await transaction<
      {
        customerName: string;
        contactType: CustomerContactType | null;
        normalizedContact: string | null;
        sourceContent: string;
        sourceDirection: MessageDirection;
        sourceSenderType: MessageSenderType;
        productId: string | null;
        productName: string | null;
        draftOrderId: string | null;
        draftStatus: string | null;
        customerPhone: string | null;
        shippingAddress: Record<string, unknown> | null;
        itemCount: number;
        orderId: string | null;
        orderNumber: string | null;
      }[]
    >`
      select
        customer.name as "customerName",
        contact.type::text as "contactType",
        contact.normalized_value as "normalizedContact",
        source_message.content as "sourceContent",
        source_message.direction::text as "sourceDirection",
        source_message.sender_type::text as "sourceSenderType",
        coalesce(conversation.product_id, draft_item.product_id)::text as "productId",
        coalesce(product.name, draft_item.product_name_snapshot) as "productName",
        conversation.draft_order_id::text as "draftOrderId",
        draft.status::text as "draftStatus",
        draft.customer_phone as "customerPhone",
        draft.shipping_address as "shippingAddress",
        coalesce(draft_items.item_count, 0)::int as "itemCount",
        conversation.order_id::text as "orderId",
        orders.number as "orderNumber"
      from conversations as conversation
      join customers as customer
        on customer.tenant_id = conversation.tenant_id
        and customer.id = conversation.customer_id
      join messages as source_message
        on source_message.tenant_id = conversation.tenant_id
        and source_message.conversation_id = conversation.id
        and source_message.id = ${sourceMessageId}
      left join lateral (
        select type, normalized_value
        from customer_contacts
        where tenant_id = conversation.tenant_id
          and customer_id = conversation.customer_id
        order by is_primary desc, created_at, id
        limit 1
      ) as contact on true
      left join draft_orders as draft
        on draft.tenant_id = conversation.tenant_id
        and draft.id = conversation.draft_order_id
      left join lateral (
        select count(*)::int as item_count
        from draft_order_items
        where tenant_id = conversation.tenant_id
          and draft_order_id = conversation.draft_order_id
      ) as draft_items on true
      left join lateral (
        select product_id, product_name_snapshot
        from draft_order_items
        where tenant_id = conversation.tenant_id
          and draft_order_id = conversation.draft_order_id
        order by created_at, id
        limit 1
      ) as draft_item on true
      left join products as product
        on product.tenant_id = conversation.tenant_id
        and product.id = coalesce(conversation.product_id, draft_item.product_id)
      left join orders
        on orders.tenant_id = conversation.tenant_id
        and orders.id = conversation.order_id
      where conversation.tenant_id = ${tenantId}
        and conversation.id = ${conversationId}
      limit 1
    `;
    if (!row) throw new NotFoundException('Conversation or source message not found.');
    if (row.sourceDirection !== 'inbound' || row.sourceSenderType !== 'customer') {
      throw new BadRequestException('A handoff must originate from an inbound customer message.');
    }
    const address = row.shippingAddress;
    const hasShippingAddress =
      address !== null &&
      typeof address.line1 === 'string' &&
      address.line1.trim().length > 0 &&
      typeof address.city === 'string' &&
      address.city.trim().length > 0;
    return {
      schemaVersion: 1,
      intent,
      reason,
      customerRequest: boundedSummaryText(row.sourceContent),
      customer: {
        name: row.customerName,
        contactHint:
          row.contactType && row.normalizedContact
            ? maskCustomerContact(row.contactType, row.normalizedContact)
            : null,
      },
      product:
        row.productId && row.productName ? { id: row.productId, name: row.productName } : null,
      collectedData: {
        draftOrderId: row.draftOrderId,
        draftStatus: row.draftStatus,
        hasCustomerPhone: Boolean(row.customerPhone),
        hasShippingAddress,
        itemCount: row.itemCount,
        orderId: row.orderId,
        orderNumber: row.orderNumber,
      },
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

  async getHandoffMetrics(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
  ): Promise<HandoffMetricsView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'conversations:read');
      const [metrics] = await transaction<
        {
          pending: number;
          active: number;
          resolved: number;
          averageFirstResponseSeconds: number | null;
          averageResolutionSeconds: number | null;
        }[]
      >`
        select
          count(*) filter (where status = 'pending')::int as pending,
          count(*) filter (where status = 'active')::int as active,
          count(*) filter (where status = 'resolved')::int as resolved,
          round(
            avg(extract(epoch from (first_claimed_at - requested_at)))
            filter (where first_claimed_at is not null)
          )::int as "averageFirstResponseSeconds",
          round(
            avg(extract(epoch from (resolved_at - requested_at)))
            filter (where resolved_at is not null)
          )::int as "averageResolutionSeconds"
        from handoffs
        where tenant_id = ${context.tenantId}
      `;
      return (
        metrics ?? {
          pending: 0,
          active: 0,
          resolved: 0,
          averageFirstResponseSeconds: null,
          averageResolutionSeconds: null,
        }
      );
    });
  }

  async requestHandoff(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    conversationId: string,
    input: RequestHandoffInput,
  ): Promise<RequestHandoffResult> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'conversations:manage');
      await transaction`
        select pg_advisory_xact_lock(
          hashtextextended(
            ${`${context.tenantId}:handoff:${input.idempotencyKey}`},
            0::bigint
          )
        )
      `;
      const currentUserId = await this.currentUserId(transaction, context.tenantId);
      const [existing] = await transaction<
        {
          id: string;
          customerNoticeMessageId: string | null;
        }[]
      >`
        select
          id::text,
          customer_notice_message_id::text as "customerNoticeMessageId"
        from handoffs
        where tenant_id = ${context.tenantId}
          and idempotency_key = ${input.idempotencyKey}
        limit 1
      `;
      if (existing) {
        const handoff = (
          await this.loadHandoffs(transaction, context.tenantId, conversationId, currentUserId)
        ).find((item) => item.id === existing.id);
        if (!handoff || !existing.customerNoticeMessageId) {
          throw new ConflictException('Stored handoff is incomplete.');
        }
        const [customerMessage] = await transaction<
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
            sender_id as "senderId", external_id as "externalId",
            content, metadata, created_at as "createdAt"
          from messages
          where tenant_id = ${context.tenantId}
            and id = ${existing.customerNoticeMessageId}
          limit 1
        `;
        const [toolCall] = await transaction<{ id: string }[]>`
          select id::text
          from ai_tool_calls
          where tenant_id = ${context.tenantId}
            and run_id = ${input.sourceRunId}
            and name = 'request_human_handoff'
          order by created_at, id
          limit 1
        `;
        if (!customerMessage || !toolCall) {
          throw new ConflictException('Stored handoff notification is incomplete.');
        }
        const agentReply: CustomerAgentReply = {
          ...input.agentReply,
          handoffId: handoff.id,
          toolCallIds: [...new Set([...input.agentReply.toolCallIds, toolCall.id])],
        };
        return {
          handoff,
          customerMessage: {
            ...customerMessage,
            createdAt: customerMessage.createdAt.toISOString(),
            replayed: true,
          },
          agentReply,
          toolCallId: toolCall.id,
        };
      }

      const [conversation] = await transaction<
        {
          status: ConversationStatus;
          version: number;
        }[]
      >`
        select status::text, version
        from conversations
        where tenant_id = ${context.tenantId} and id = ${conversationId}
        limit 1
        for update
      `;
      if (!conversation) throw new NotFoundException('Conversation not found.');
      if (conversation.status !== 'bot') {
        throw new ConflictException('The conversation is already owned by the human queue.');
      }
      const [run] = await transaction<{ id: string }[]>`
        select id::text
        from ai_runs
        where tenant_id = ${context.tenantId}
          and id = ${input.sourceRunId}
          and conversation_id = ${conversationId}
          and outcome = 'handoff'
        limit 1
      `;
      if (!run) throw new ConflictException('A completed handoff trace is required.');
      const summary = await this.buildHandoffSummary(
        transaction,
        context.tenantId,
        conversationId,
        input.sourceMessageId,
        input.intent,
        input.reason,
      );
      const [created] = await transaction<{ id: string }[]>`
        insert into handoffs (
          tenant_id, conversation_id, source_message_id, source_run_id,
          reason, status, intent, summary, idempotency_key
        ) values (
          ${context.tenantId}, ${conversationId}, ${input.sourceMessageId},
          ${input.sourceRunId}, ${input.reason}, 'pending', ${input.intent},
          ${transaction.json(jsonInput(summary))}, ${input.idempotencyKey}
        )
        returning id::text
      `;
      if (!created) throw new Error('Handoff insert returned no ID.');
      const toolCallId = randomUUID();
      const agentReply: CustomerAgentReply = {
        ...input.agentReply,
        handoffId: created.id,
        toolCallIds: [...new Set([...input.agentReply.toolCallIds, toolCallId])],
      };
      const customerMessage = await this.appendMessageInTransaction(
        transaction,
        identity,
        context.tenantId,
        conversationId,
        {
          direction: 'outbound',
          senderType: 'bot',
          senderId: 'customer-agent',
          externalId: `agent-reply:${input.sourceMessageId}`,
          content: input.customerNotice,
          metadata: {
            kind: 'customer_agent_reply',
            inReplyToMessageId: input.sourceMessageId,
            agentReply,
            handoffId: created.id,
          },
        },
      );
      await transaction`
        update handoffs
        set customer_notice_message_id = ${customerMessage.id}, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${created.id}
      `;
      await transaction`
        update conversations
        set
          status = 'needs_human',
          assigned_to_user_id = null,
          version = version + 1,
          closed_at = null,
          updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${conversationId}
      `;
      await transaction`
        insert into conversation_transitions (
          tenant_id, conversation_id, from_status, to_status, actor_id, reason
        ) values (
          ${context.tenantId}, ${conversationId}, 'bot', 'needs_human',
          ${identity.subject}, ${input.reason}
        )
      `;
      await this.appendMessageInTransaction(
        transaction,
        identity,
        context.tenantId,
        conversationId,
        {
          direction: 'internal',
          senderType: 'system',
          senderId: null,
          externalId: `handoff-notice:${created.id}`,
          content: `Human handoff requested: ${input.reason}`,
          metadata: {
            kind: 'handoff_notification',
            handoffId: created.id,
            reason: input.reason,
            summary,
          },
        },
      );
      await transaction`
        insert into ai_tool_calls (
          id, tenant_id, run_id, provider_call_id, name, kind, status,
          latency_ms, safe_input, safe_output, error_code
        ) values (
          ${toolCallId}, ${context.tenantId}, ${input.sourceRunId},
          ${`application:${input.sourceMessageId}:handoff`},
          'request_human_handoff', 'command', 'succeeded', 0,
          ${transaction.json(
            jsonInput({
              conversationId,
              sourceMessageId: input.sourceMessageId,
              reason: input.reason,
              intent: input.intent,
            }),
          )},
          ${transaction.json(
            jsonInput({
              handoffId: created.id,
              status: 'pending',
              conversationStatus: 'needs_human',
            }),
          )},
          null
        )
      `;
      await this.auditTransition(
        transaction,
        identity,
        context.tenantId,
        correlationId,
        conversationId,
        'bot',
        'needs_human',
      );
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type,
          entity_id, correlation_id, metadata
        ) values (
          ${context.tenantId}, 'system', 'customer-agent', 'handoff.requested',
          'handoff', ${created.id}, ${correlationId},
          ${transaction.json({
            conversationId,
            sourceMessageId: input.sourceMessageId,
            reason: input.reason,
            intent: input.intent,
          })}
        )
      `;
      const handoff = (
        await this.loadHandoffs(transaction, context.tenantId, conversationId, currentUserId)
      ).find((item) => item.id === created.id);
      if (!handoff) throw new Error('Created handoff could not be loaded.');
      return { handoff, customerMessage, agentReply, toolCallId };
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
        const [claimedHandoff] = await transaction<{ id: string }[]>`
          update handoffs
          set
            status = 'active',
            assigned_to_user_id = ${currentUserId},
            first_claimed_at = coalesce(first_claimed_at, now()),
            claimed_at = now(),
            version = version + 1,
            updated_at = now()
          where tenant_id = ${context.tenantId}
            and conversation_id = ${conversationId}
            and status = 'pending'
          returning id::text
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
        if (claimedHandoff) {
          await transaction`
            insert into audit_events (
              tenant_id, actor_type, actor_id, action, entity_type,
              entity_id, correlation_id, metadata
            ) values (
              ${context.tenantId}, 'user', ${identity.subject}, 'handoff.claimed',
              'handoff', ${claimedHandoff.id}, ${correlationId},
              ${transaction.json({ conversationId })}
            )
          `;
        }
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

  async release(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    conversationId: string,
    input: ReleaseConversationInput,
  ): Promise<ConversationView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'conversations:manage');
      const currentUserId = await this.currentUserId(transaction, context.tenantId);
      const [current] = await transaction<
        {
          status: ConversationStatus;
          assignedToUserId: string | null;
          version: number;
        }[]
      >`
        select
          status::text,
          assigned_to_user_id::text as "assignedToUserId",
          version
        from conversations
        where tenant_id = ${context.tenantId} and id = ${conversationId}
        limit 1
        for update
      `;
      if (!current) throw new NotFoundException('Conversation not found.');
      if (current.version !== input.expectedVersion) {
        throw new ConflictException({
          message: 'Conversation changed; reload before releasing it.',
          currentVersion: current.version,
        });
      }
      if (current.status !== 'human' || current.assignedToUserId !== currentUserId) {
        throw new ConflictException('Only the assigned agent can release an active conversation.');
      }
      await transaction`
        update conversations
        set
          status = 'needs_human',
          assigned_to_user_id = null,
          version = version + 1,
          updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${conversationId}
      `;
      const [releasedHandoff] = await transaction<{ id: string }[]>`
        update handoffs
        set
          status = 'pending',
          assigned_to_user_id = null,
          claimed_at = null,
          released_at = now(),
          version = version + 1,
          updated_at = now()
        where tenant_id = ${context.tenantId}
          and conversation_id = ${conversationId}
          and status = 'active'
          and assigned_to_user_id = ${currentUserId}
        returning id::text
      `;
      await transaction`
        insert into conversation_transitions (
          tenant_id, conversation_id, from_status, to_status, actor_id, reason
        ) values (
          ${context.tenantId}, ${conversationId}, 'human', 'needs_human',
          ${identity.subject}, ${input.reason}
        )
      `;
      await this.appendMessageInTransaction(
        transaction,
        identity,
        context.tenantId,
        conversationId,
        {
          direction: 'internal',
          senderType: 'system',
          senderId: null,
          externalId: releasedHandoff
            ? `handoff-release:${releasedHandoff.id}:${current.version}`
            : `conversation-release:${conversationId}:${current.version}`,
          content: 'Conversation released to the human queue.',
          metadata: {
            kind: 'handoff_released',
            handoffId: releasedHandoff?.id ?? null,
            reason: input.reason,
          },
        },
      );
      await this.auditTransition(
        transaction,
        identity,
        context.tenantId,
        correlationId,
        conversationId,
        'human',
        'needs_human',
      );
      if (releasedHandoff) {
        await transaction`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action, entity_type,
            entity_id, correlation_id, metadata
          ) values (
            ${context.tenantId}, 'user', ${identity.subject}, 'handoff.released',
            'handoff', ${releasedHandoff.id}, ${correlationId},
            ${transaction.json({ conversationId, reason: input.reason })}
          )
        `;
      }
      const result = await this.loadConversation(
        transaction,
        context.tenantId,
        conversationId,
        currentUserId,
      );
      if (!result) throw new Error('Released conversation could not be loaded.');
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
      if (
        current.status === 'human' &&
        current.assignedToUserId &&
        current.assignedToUserId !== currentUserId
      ) {
        throw new ConflictException('Only the assigned agent can change an active conversation.');
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
      let changedHandoff: { id: string } | undefined;
      let handoffAction: 'handoff.claimed' | 'handoff.released' | 'handoff.resolved' | null = null;
      if (input.targetStatus === 'human') {
        [changedHandoff] = await transaction<{ id: string }[]>`
          update handoffs
          set
            status = 'active',
            assigned_to_user_id = ${currentUserId},
            first_claimed_at = coalesce(first_claimed_at, now()),
            claimed_at = now(),
            version = version + 1,
            updated_at = now()
          where tenant_id = ${context.tenantId}
            and conversation_id = ${conversationId}
            and status = 'pending'
          returning id::text
        `;
        handoffAction = changedHandoff ? 'handoff.claimed' : null;
      } else if (input.targetStatus === 'needs_human' && current.status === 'human') {
        [changedHandoff] = await transaction<{ id: string }[]>`
          update handoffs
          set
            status = 'pending',
            assigned_to_user_id = null,
            claimed_at = null,
            released_at = now(),
            version = version + 1,
            updated_at = now()
          where tenant_id = ${context.tenantId}
            and conversation_id = ${conversationId}
            and status = 'active'
          returning id::text
        `;
        handoffAction = changedHandoff ? 'handoff.released' : null;
      } else if (input.targetStatus === 'bot' || input.targetStatus === 'closed') {
        const resolution: HandoffResolutionCode =
          input.targetStatus === 'bot' ? 'returned_to_bot' : 'conversation_closed';
        [changedHandoff] = await transaction<{ id: string }[]>`
          update handoffs
          set
            status = 'resolved',
            resolution = ${resolution},
            claimed_at = null,
            resolved_at = now(),
            version = version + 1,
            updated_at = now()
          where tenant_id = ${context.tenantId}
            and conversation_id = ${conversationId}
            and status in ('pending', 'active')
          returning id::text
        `;
        handoffAction = changedHandoff ? 'handoff.resolved' : null;
      }
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
      if (changedHandoff && handoffAction) {
        await transaction`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action, entity_type,
            entity_id, correlation_id, metadata
          ) values (
            ${context.tenantId}, 'user', ${identity.subject}, ${handoffAction},
            'handoff', ${changedHandoff.id}, ${correlationId},
            ${transaction.json({
              conversationId,
              targetStatus: input.targetStatus,
              reason: input.reason ?? null,
            })}
          )
        `;
      }
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
