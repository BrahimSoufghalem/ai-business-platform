import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TenantId } from '@ai-business/domain';
import type { DeliveryResult, InboundMessageEnvelope, InstagramAdapter } from './index.js';

const DEFAULT_GRAPH_VERSION = 'v26.0';
const DEFAULT_GRAPH_BASE_URL = 'https://graph.instagram.com';
const MAX_WEBHOOK_ENTRIES = 100;
const MAX_EVENTS_PER_ENTRY = 100;
const MAX_MEDIA_PER_MESSAGE = 10;
const MAX_INBOUND_TEXT_LENGTH = 4_000;
const MAX_OUTBOUND_TEXT_LENGTH = 1_000;

export interface InstagramAdapterConfiguration {
  readonly appSecret: string;
  readonly accessToken?: string;
  readonly accountId: string;
  readonly graphApiVersion?: string;
  readonly graphBaseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => Date;
}

interface MetaErrorBody {
  readonly error?: {
    readonly code?: number;
    readonly type?: string;
  };
}

interface MetaDeliveryBody {
  readonly recipient_id?: string;
  readonly message_id?: string;
}

export class InstagramConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstagramConfigurationError';
  }
}

export class InstagramPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstagramPayloadError';
  }
}

export class InstagramDeliveryError extends Error {
  constructor(
    readonly status: number,
    readonly providerCode: number | null,
    readonly providerType: string | null,
  ) {
    super(
      `Instagram delivery failed (${status}${providerCode === null ? '' : `/${providerCode}`}).`,
    );
    this.name = 'InstagramDeliveryError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 200 ? normalized : null;
}

function safeTimestamp(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function secretEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function verifyInstagramWebhookSignature(
  rawBody: Uint8Array,
  signature: string,
  appSecret: string,
): boolean {
  const match = /^sha256=([a-f0-9]{64})$/u.exec(signature);
  if (!match?.[1] || appSecret.length < 16) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const supplied = Buffer.from(match[1], 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function verifyInstagramWebhookChallenge(
  query: Readonly<Record<string, unknown>>,
  verifyToken: string,
): string | null {
  const mode = query['hub.mode'];
  const suppliedToken = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (
    mode !== 'subscribe' ||
    typeof suppliedToken !== 'string' ||
    typeof challenge !== 'string' ||
    challenge.length === 0 ||
    challenge.length > 500
  ) {
    return null;
  }
  return secretEquals(suppliedToken, verifyToken) ? challenge : null;
}

export class InstagramLiveAdapter implements InstagramAdapter {
  readonly channel = 'instagram' as const;
  private readonly appSecret: string;
  private readonly accessToken: string | null;
  private readonly accountId: string;
  private readonly graphApiVersion: string;
  private readonly graphBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => Date;

  constructor(configuration: InstagramAdapterConfiguration) {
    if (configuration.appSecret.trim().length < 16) {
      throw new InstagramConfigurationError('Instagram app secret is missing or too short.');
    }
    if (configuration.accessToken !== undefined && configuration.accessToken.trim().length < 10) {
      throw new InstagramConfigurationError('Instagram access token is missing or too short.');
    }
    if (!/^[0-9]{1,80}$/u.test(configuration.accountId)) {
      throw new InstagramConfigurationError('Instagram professional account ID is invalid.');
    }
    const version = configuration.graphApiVersion ?? DEFAULT_GRAPH_VERSION;
    if (!/^v[0-9]{1,2}\.[0-9]$/u.test(version)) {
      throw new InstagramConfigurationError('Meta Graph API version is invalid.');
    }
    const baseUrl = new URL(configuration.graphBaseUrl ?? DEFAULT_GRAPH_BASE_URL);
    if (baseUrl.protocol !== 'https:') {
      throw new InstagramConfigurationError('Meta Graph base URL must use HTTPS.');
    }
    const timeoutMs = configuration.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
      throw new InstagramConfigurationError('Instagram timeout must be between 100 and 30000ms.');
    }

    this.appSecret = configuration.appSecret;
    this.accessToken = configuration.accessToken ?? null;
    this.accountId = configuration.accountId;
    this.graphApiVersion = version;
    this.graphBaseUrl = baseUrl.toString().replace(/\/$/u, '');
    this.timeoutMs = timeoutMs;
    this.fetchImplementation = configuration.fetchImplementation ?? fetch;
    this.now = configuration.now ?? (() => new Date());
  }

  async verifyWebhookSignature(rawBody: Uint8Array, signature: string): Promise<boolean> {
    return verifyInstagramWebhookSignature(rawBody, signature, this.appSecret);
  }

  async normalizeInbound(payload: unknown, tenantId: TenantId): Promise<InboundMessageEnvelope[]> {
    const root = record(payload);
    if (!root || root.object !== 'instagram' || !Array.isArray(root.entry)) {
      throw new InstagramPayloadError('Instagram webhook payload is invalid.');
    }
    if (root.entry.length > MAX_WEBHOOK_ENTRIES) {
      throw new InstagramPayloadError('Instagram webhook contains too many entries.');
    }

    const normalized: InboundMessageEnvelope[] = [];
    for (const entryValue of root.entry) {
      const entry = record(entryValue);
      if (!entry || safeIdentifier(entry.id) !== this.accountId) continue;
      if (!Array.isArray(entry.messaging) || entry.messaging.length > MAX_EVENTS_PER_ENTRY) {
        if (Array.isArray(entry.messaging)) {
          throw new InstagramPayloadError('Instagram webhook contains too many events.');
        }
        continue;
      }

      for (const eventValue of entry.messaging) {
        const event = record(eventValue);
        const sender = record(event?.sender);
        const message = record(event?.message);
        if (!event || !sender || !message) continue;
        if (
          message.is_echo === true ||
          message.is_deleted === true ||
          message.is_unsupported === true
        )
          continue;

        const senderId = safeIdentifier(sender.id);
        const messageId = safeIdentifier(message.mid);
        const receivedAt = safeTimestamp(event.timestamp);
        if (!senderId || !messageId || !receivedAt) continue;

        const text =
          typeof message.text === 'string' && message.text.trim().length > 0
            ? message.text.trim().slice(0, MAX_INBOUND_TEXT_LENGTH)
            : undefined;
        const mediaUrls = Array.isArray(message.attachments)
          ? [
              ...new Set(
                message.attachments
                  .slice(0, MAX_MEDIA_PER_MESSAGE)
                  .map((attachment) => safeMediaUrl(record(record(attachment)?.payload)?.url))
                  .filter((url): url is string => url !== null),
              ),
            ]
          : [];
        if (!text && mediaUrls.length === 0) continue;

        normalized.push({
          tenantId,
          channel: 'instagram',
          externalMessageId: messageId,
          externalConversationId: senderId,
          senderId,
          receivedAt,
          ...(text ? { text } : {}),
          ...(mediaUrls.length > 0 ? { mediaUrls } : {}),
        });
      }
    }
    return normalized;
  }

  async deliver(
    conversationId: string,
    message: { readonly text: string },
  ): Promise<DeliveryResult> {
    if (!this.accessToken) {
      throw new InstagramConfigurationError(
        'Instagram access token is required for outbound delivery.',
      );
    }
    if (!/^[0-9]{1,80}$/u.test(conversationId)) {
      throw new InstagramPayloadError('Instagram-scoped recipient ID is invalid.');
    }
    const text = message.text.trim();
    if (text.length < 1 || text.length > MAX_OUTBOUND_TEXT_LENGTH) {
      throw new InstagramPayloadError('Instagram text must contain between 1 and 1000 characters.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImplementation(
        `${this.graphBaseUrl}/${this.graphApiVersion}/${this.accountId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recipient: { id: conversationId },
            message: { text },
          }),
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    const body = (await response.json().catch(() => null)) as
      MetaDeliveryBody | MetaErrorBody | null;
    if (!response.ok) {
      const error = record(body)?.error;
      const providerError = record(error);
      throw new InstagramDeliveryError(
        response.status,
        typeof providerError?.code === 'number' ? providerError.code : null,
        typeof providerError?.type === 'string' ? providerError.type : null,
      );
    }
    const recipientId = safeIdentifier(record(body)?.recipient_id);
    const messageId = safeIdentifier(record(body)?.message_id);
    if (recipientId !== conversationId || !messageId) {
      throw new InstagramDeliveryError(response.status, null, 'invalid_response');
    }
    return {
      externalMessageId: messageId,
      acceptedAt: this.now().toISOString(),
    };
  }
}
