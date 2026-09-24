import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { TenantId } from '@ai-business/domain';
import {
  InstagramLiveAdapter,
  InstagramPayloadError,
  verifyInstagramWebhookChallenge,
} from '@ai-business/integrations';
import { DatabaseService } from '../database/database.service.js';

interface WebhookEntry {
  readonly id: string;
  readonly value: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function appSecret(): string {
  const value = process.env.INSTAGRAM_APP_SECRET?.trim() ?? '';
  if (value.length < 16) {
    throw new ServiceUnavailableException('Instagram webhook is not configured.');
  }
  return value;
}

function verifyToken(): string {
  const value = process.env.INSTAGRAM_VERIFY_TOKEN?.trim() ?? '';
  if (value.length < 16) {
    throw new ServiceUnavailableException('Instagram webhook is not configured.');
  }
  return value;
}

function webhookEntries(payload: unknown): WebhookEntry[] {
  const root = record(payload);
  if (!root || root.object !== 'instagram' || !Array.isArray(root.entry)) {
    throw new BadRequestException('Instagram webhook payload is invalid.');
  }
  if (root.entry.length > 100) {
    throw new BadRequestException('Instagram webhook contains too many entries.');
  }

  return root.entry.map((value) => {
    const entry = record(value);
    if (!entry || typeof entry.id !== 'string' || !/^[0-9]{1,80}$/u.test(entry.id)) {
      throw new BadRequestException('Instagram webhook entry is invalid.');
    }
    return { id: entry.id, value };
  });
}

@Injectable()
export class InstagramWebhookService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  verifySubscription(query: Readonly<Record<string, unknown>>): string {
    const challenge = verifyInstagramWebhookChallenge(query, verifyToken());
    if (!challenge) throw new ForbiddenException('Instagram webhook verification failed.');
    return challenge;
  }

  async accept(payload: unknown): Promise<{ received: true; acceptedMessages: number }> {
    let acceptedMessages = 0;
    for (const entry of webhookEntries(payload)) {
      const [mapping] = await this.database.client<{ tenantId: TenantId }[]>`
        select app_resolve_instagram_tenant(${entry.id})::text as "tenantId"
      `;
      if (!mapping?.tenantId) continue;

      const adapter = new InstagramLiveAdapter({
        appSecret: appSecret(),
        accountId: entry.id,
      });
      try {
        const normalized = await adapter.normalizeInbound(
          { object: 'instagram', entry: [entry.value] },
          mapping.tenantId,
        );
        acceptedMessages += normalized.length;
      } catch (error) {
        if (error instanceof InstagramPayloadError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }
    }

    return { received: true, acceptedMessages };
  }
}
