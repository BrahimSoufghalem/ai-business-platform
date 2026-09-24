import type { TenantId } from '@ai-business/domain';

export type Channel = 'internal' | 'instagram';

export interface InboundMessageEnvelope {
  readonly tenantId: TenantId;
  readonly channel: Channel;
  readonly externalMessageId: string;
  readonly externalConversationId: string;
  readonly senderId: string;
  readonly receivedAt: string;
  readonly text?: string;
  readonly mediaUrls?: readonly string[];
}

export interface DeliveryResult {
  readonly externalMessageId: string;
  readonly acceptedAt: string;
}

export interface ChannelAdapter {
  readonly channel: Channel;
  verifyWebhookSignature(rawBody: Uint8Array, signature: string): Promise<boolean>;
  normalizeInbound(payload: unknown, tenantId: TenantId): Promise<InboundMessageEnvelope[]>;
  deliver(conversationId: string, message: { readonly text: string }): Promise<DeliveryResult>;
}

/** Contract for the first external Pilot channel. */
export interface InstagramAdapter extends ChannelAdapter {
  readonly channel: 'instagram';
}

export * from './instagram-adapter.js';
