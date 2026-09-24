import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { withTenantTransaction } from '@ai-business/db';
import { InstagramCredentialError, InstagramCredentialVault } from '@ai-business/integrations';
import { DatabaseService } from '../database/database.service.js';
import { authorizeTenantPermission } from '../tenancy/tenant-authorization.js';
import { createCandidateTenantContext } from '../tenancy/trusted-tenant-context.js';
import type { ConnectInstagramAccountInput } from './instagram-connection.schemas.js';

interface InstagramAccountRow {
  readonly id: string;
  readonly accountId: string;
  readonly tokenFingerprint: string;
  readonly status: 'active' | 'disabled' | 'reauthorization_required';
  readonly connectedAt: Date;
  readonly lastValidatedAt: Date | null;
  readonly updatedAt: Date;
}

export interface InstagramConnectionView {
  readonly id: string;
  readonly accountId: string;
  readonly accountIdSuffix: string;
  readonly tokenFingerprint: string;
  readonly status: 'active' | 'disabled' | 'reauthorization_required';
  readonly connectedAt: string;
  readonly lastValidatedAt: string | null;
  readonly updatedAt: string;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function toView(row: InstagramAccountRow): InstagramConnectionView {
  return {
    ...row,
    accountIdSuffix: row.accountId.slice(-4),
    connectedAt: row.connectedAt.toISOString(),
    lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function credentialVault(): InstagramCredentialVault {
  try {
    return new InstagramCredentialVault(process.env.INSTAGRAM_CREDENTIAL_ENCRYPTION_KEY ?? '');
  } catch (error) {
    if (error instanceof InstagramCredentialError) {
      throw new ServiceUnavailableException('Instagram credential storage is not configured.');
    }
    throw error;
  }
}

@Injectable()
export class InstagramConnectionService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async get(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
  ): Promise<InstagramConnectionView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'tenant:manage');
      const [connection] = await transaction<InstagramAccountRow[]>`
        select
          id::text, instagram_account_id as "accountId",
          token_fingerprint as "tokenFingerprint", status::text,
          connected_at as "connectedAt", last_validated_at as "lastValidatedAt",
          updated_at as "updatedAt"
        from instagram_accounts
        where tenant_id = ${context.tenantId}
        limit 1
      `;
      if (!connection) throw new NotFoundException('Instagram connection not found.');
      return toView(connection);
    });
  }

  async connect(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: ConnectInstagramAccountInput,
  ): Promise<InstagramConnectionView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    try {
      return await withTenantTransaction(this.database.client, context, async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'tenant:manage');
        const encrypted = credentialVault().encrypt(
          { tenantId: context.tenantId, accountId: input.accountId },
          input.accessToken,
        );
        const [connection] = await transaction<InstagramAccountRow[]>`
          insert into instagram_accounts (
            tenant_id, instagram_account_id, access_token_ciphertext,
            access_token_iv, access_token_auth_tag, encryption_key_version,
            token_fingerprint, status
          ) values (
            ${context.tenantId}, ${input.accountId}, ${encrypted.ciphertext},
            ${encrypted.iv}, ${encrypted.authTag}, ${encrypted.keyVersion},
            ${encrypted.fingerprint}, 'active'
          )
          on conflict (tenant_id) do update set
            instagram_account_id = excluded.instagram_account_id,
            access_token_ciphertext = excluded.access_token_ciphertext,
            access_token_iv = excluded.access_token_iv,
            access_token_auth_tag = excluded.access_token_auth_tag,
            encryption_key_version = excluded.encryption_key_version,
            token_fingerprint = excluded.token_fingerprint,
            status = 'active',
            connected_at = now(),
            last_validated_at = null,
            updated_at = now()
          returning
            id::text, instagram_account_id as "accountId",
            token_fingerprint as "tokenFingerprint", status::text,
            connected_at as "connectedAt", last_validated_at as "lastValidatedAt",
            updated_at as "updatedAt"
        `;
        if (!connection) throw new Error('Instagram connection was not persisted.');

        await transaction`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action, entity_type, entity_id,
            correlation_id, metadata
          ) values (
            ${context.tenantId}, 'user', ${identity.subject},
            'instagram.connection.saved', 'instagram_account', ${connection.id},
            ${correlationId}, ${transaction.json({
              accountIdSuffix: input.accountId.slice(-4),
              tokenFingerprint: encrypted.fingerprint,
            })}
          )
        `;
        return toView(connection);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('This Instagram account is already connected.');
      }
      throw error;
    }
  }

  async disconnect(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
  ): Promise<void> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    await withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'tenant:manage');
      const [deleted] = await transaction<{ id: string; accountId: string }[]>`
        delete from instagram_accounts
        where tenant_id = ${context.tenantId}
        returning id::text, instagram_account_id as "accountId"
      `;
      if (!deleted) throw new NotFoundException('Instagram connection not found.');

      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type, entity_id,
          correlation_id, metadata
        ) values (
          ${context.tenantId}, 'user', ${identity.subject},
          'instagram.connection.deleted', 'instagram_account', ${deleted.id},
          ${correlationId}, ${transaction.json({
            accountIdSuffix: deleted.accountId.slice(-4),
          })}
        )
      `;
    });
  }
}
