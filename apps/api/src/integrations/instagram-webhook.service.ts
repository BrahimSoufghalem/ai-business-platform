import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
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

interface IngestionResult {
  readonly replayed: boolean;
  readonly jobEnqueued: boolean;
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

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

@Injectable()
export class InstagramWebhookService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  verifySubscription(query: Readonly<Record<string, unknown>>): string {
    const challenge = verifyInstagramWebhookChallenge(query, verifyToken());
    if (!challenge) throw new ForbiddenException('Instagram webhook verification failed.');
    return challenge;
  }

  async accept(
    payload: unknown,
    correlationId: string,
  ): Promise<{
    received: true;
    acceptedMessages: number;
    replayedMessages: number;
    queuedJobs: number;
  }> {
    let acceptedMessages = 0;
    let replayedMessages = 0;
    let queuedJobs = 0;
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
        for (const message of normalized) {
          const content = message.text ?? '[Instagram attachment]';
          const metadata = {
            channel: 'instagram',
            receivedAt: message.receivedAt,
            mediaUrls: message.mediaUrls ?? [],
          };
          const [result] = await this.database.client<IngestionResult[]>`
            select
              replayed,
              job_enqueued as "jobEnqueued"
            from app_ingest_instagram_message(
              ${entry.id},
              ${message.externalMessageId},
              ${message.externalConversationId},
              ${message.senderId},
              ${message.receivedAt},
              ${content},
              ${this.database.client.json(metadata)},
              ${fingerprint({
                externalMessageId: message.externalMessageId,
                externalConversationId: message.externalConversationId,
                senderId: message.senderId,
                content,
                metadata,
              })},
              ${correlationId}
            )
          `;
          if (!result) continue;
          if (result.replayed) replayedMessages += 1;
          else acceptedMessages += 1;
          if (result.jobEnqueued) queuedJobs += 1;
        }
      } catch (error) {
        if (error instanceof InstagramPayloadError) {
          throw new BadRequestException(error.message);
        }
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            'Instagram external message ID was reused with different content.',
          );
        }
        throw error;
      }
    }

    return { received: true, acceptedMessages, replayedMessages, queuedJobs };
  }
}
