import type { DatabaseClient } from '@ai-business/db';
import type { InstagramEncryptedAccessToken } from '@ai-business/integrations';

export interface ClaimedInstagramDelivery {
  readonly jobId: string;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly recipientId: string | null;
  readonly content: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly correlationId: string;
  readonly account: {
    readonly id: string;
    readonly status: string;
    readonly encryptedToken: InstagramEncryptedAccessToken;
  } | null;
}

export interface InstagramDeliveryQueue {
  claim(workerId: string): Promise<ClaimedInstagramDelivery | null>;
  complete(jobId: string, workerId: string, externalMessageId: string): Promise<void>;
  fail(
    jobId: string,
    workerId: string,
    errorCode: string,
    retryAt: string | null,
  ): Promise<'pending' | 'dead'>;
}

interface ClaimedRow {
  readonly jobId: string;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly recipientId: string | null;
  readonly content: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly correlationId: string;
  readonly accountId: string | null;
  readonly accountStatus: string | null;
  readonly accessTokenCiphertext: string | null;
  readonly accessTokenIv: string | null;
  readonly accessTokenAuthTag: string | null;
  readonly encryptionKeyVersion: number | null;
  readonly tokenFingerprint: string | null;
}

export class PostgresInstagramDeliveryQueue implements InstagramDeliveryQueue {
  constructor(private readonly client: DatabaseClient) {}

  async claim(workerId: string): Promise<ClaimedInstagramDelivery | null> {
    const [row] = await this.client<ClaimedRow[]>`
      select
        job_id as "jobId",
        tenant_id as "tenantId",
        conversation_id as "conversationId",
        message_id as "messageId",
        recipient_id as "recipientId",
        content,
        attempts,
        max_attempts as "maxAttempts",
        correlation_id as "correlationId",
        account_id as "accountId",
        account_status as "accountStatus",
        access_token_ciphertext as "accessTokenCiphertext",
        access_token_iv as "accessTokenIv",
        access_token_auth_tag as "accessTokenAuthTag",
        encryption_key_version as "encryptionKeyVersion",
        token_fingerprint as "tokenFingerprint"
      from app_claim_instagram_delivery_job(${workerId})
    `;
    if (!row) return null;

    const account =
      row.accountId &&
      row.accountStatus &&
      row.accessTokenCiphertext &&
      row.accessTokenIv &&
      row.accessTokenAuthTag &&
      row.encryptionKeyVersion &&
      row.tokenFingerprint
        ? {
            id: row.accountId,
            status: row.accountStatus,
            encryptedToken: {
              ciphertext: row.accessTokenCiphertext,
              iv: row.accessTokenIv,
              authTag: row.accessTokenAuthTag,
              keyVersion: row.encryptionKeyVersion,
              fingerprint: row.tokenFingerprint,
            },
          }
        : null;

    return {
      jobId: row.jobId,
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      messageId: row.messageId,
      recipientId: row.recipientId,
      content: row.content,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      correlationId: row.correlationId,
      account,
    };
  }

  async complete(jobId: string, workerId: string, externalMessageId: string): Promise<void> {
    await this.client`
      select app_complete_instagram_delivery_job(
        ${jobId}::uuid,
        ${workerId},
        ${externalMessageId}
      )
    `;
  }

  async fail(
    jobId: string,
    workerId: string,
    errorCode: string,
    retryAt: string | null,
  ): Promise<'pending' | 'dead'> {
    const [row] = await this.client<{ status: 'pending' | 'dead' }[]>`
      select app_fail_instagram_delivery_job(
        ${jobId}::uuid,
        ${workerId},
        ${errorCode},
        ${retryAt}
      ) as status
    `;
    if (!row || (row.status !== 'pending' && row.status !== 'dead')) {
      throw new Error('Instagram delivery queue returned an invalid failure status.');
    }
    return row.status;
  }
}
