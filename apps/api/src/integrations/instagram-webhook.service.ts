import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
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

function accountDiagnostic(accountId: string): {
  readonly accountIdHash: string;
  readonly accountIdSuffix: string;
} {
  return {
    accountIdHash: createHash('sha256').update(accountId, 'utf8').digest('hex').slice(0, 12),
    accountIdSuffix: accountId.slice(-4),
  };
}

function entryShape(value: unknown): {
  readonly messagingEvents: number;
  readonly changeEvents: number;
  readonly messageChanges: number;
} {
  const entry = record(value);
  const changes = Array.isArray(entry?.changes) ? entry.changes : [];
  return {
    messagingEvents: Array.isArray(entry?.messaging) ? entry.messaging.length : 0,
    changeEvents: changes.length,
    messageChanges: changes.filter((changeValue) => record(changeValue)?.field === 'messages')
      .length,
  };
}

function accountCandidates(entryId: string, entryValue: unknown): string[] {
  const candidates = [entryId];
  const entry = record(entryValue);
  const pushRecipient = (eventValue: unknown) => {
    const recipient = record(record(eventValue)?.recipient);
    if (typeof recipient?.id === 'string' && /^[0-9]{1,80}$/u.test(recipient.id)) {
      candidates.push(recipient.id);
    }
  };
  if (Array.isArray(entry?.messaging)) entry.messaging.forEach(pushRecipient);
  if (Array.isArray(entry?.changes)) {
    for (const changeValue of entry.changes) {
      const change = record(changeValue);
      if (change?.field === 'messages') pushRecipient(change.value);
    }
  }
  return [...new Set(candidates)];
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

@Injectable()
export class InstagramWebhookService {
  private readonly logger = new Logger('InstagramWebhook');

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
    const entries = webhookEntries(payload);
    for (const entry of entries) {
      const diagnostic = accountDiagnostic(entry.id);
      const candidates = accountCandidates(entry.id, entry.value);
      let resolved: { readonly tenantId: TenantId; readonly accountId: string } | null = null;
      for (const candidate of candidates) {
        const [mapping] = await this.database.client<{ tenantId: TenantId }[]>`
          select app_resolve_instagram_tenant(${candidate})::text as "tenantId"
        `;
        if (mapping?.tenantId) {
          resolved = { tenantId: mapping.tenantId, accountId: candidate };
          break;
        }
      }
      if (!resolved) {
        this.logger.warn(
          JSON.stringify({
            event: 'instagram_webhook_entry_ignored',
            correlationId,
            reason: 'no_active_integration',
            ...diagnostic,
            candidateCount: candidates.length,
            ...entryShape(entry.value),
          }),
        );
        continue;
      }

      const adapter = new InstagramLiveAdapter({
        appSecret: appSecret(),
        accountId: resolved.accountId,
      });
      try {
        const normalized = await adapter.normalizeInbound(
          { object: 'instagram', entry: [entry.value] },
          resolved.tenantId,
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
              ${resolved.accountId},
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
        if (normalized.length === 0) {
          this.logger.warn(
            JSON.stringify({
              event: 'instagram_webhook_entry_ignored',
              correlationId,
              reason: 'no_supported_messages',
              resolvedVia: resolved.accountId === entry.id ? 'entry_id' : 'recipient_id',
              ...diagnostic,
              ...entryShape(entry.value),
            }),
          );
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

    this.logger.log(
      JSON.stringify({
        event: 'instagram_webhook_ingestion_result',
        correlationId,
        entryCount: entries.length,
        acceptedMessages,
        replayedMessages,
        queuedJobs,
      }),
    );
    return { received: true, acceptedMessages, replayedMessages, queuedJobs };
  }
}
