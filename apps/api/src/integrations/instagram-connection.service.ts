import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { withTenantTransaction } from '@ai-business/db';
import {
  InstagramConfigurationError,
  InstagramCredentialError,
  InstagramCredentialValidationError,
  InstagramCredentialVault,
  validateInstagramCredentials,
  type InstagramCredentialValidationConfiguration,
} from '@ai-business/integrations';
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

export type InstagramCredentialValidator = (
  configuration: InstagramCredentialValidationConfiguration,
) => Promise<{ readonly accountId: string; readonly username: string | null }>;

export const INSTAGRAM_CREDENTIAL_VALIDATOR = Symbol('INSTAGRAM_CREDENTIAL_VALIDATOR');

@Injectable()
export class InstagramConnectionService {
  private readonly validateCredentials: InstagramCredentialValidator;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Optional()
    @Inject(INSTAGRAM_CREDENTIAL_VALIDATOR)
    validateCredentials?: InstagramCredentialValidator,
  ) {
    this.validateCredentials = validateCredentials ?? validateInstagramCredentials;
  }

  async get(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
  ): Promise<InstagramConnectionView | null> {
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
      if (!connection) return null;
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
    await withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'tenant:manage');
    });
    try {
      await this.validateCredentials({
        accountId: input.accountId,
        accessToken: input.accessToken,
      });
    } catch (error) {
      if (error instanceof InstagramConfigurationError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof InstagramCredentialValidationError) {
        if (
          error.reason === 'invalid_credentials' ||
          error.reason === 'invalid_response' ||
          [400, 401, 403].includes(error.status)
        ) {
          throw new BadRequestException('Instagram account ID or access token is invalid.');
        }
        throw new ServiceUnavailableException(
          error.reason === 'timeout'
            ? 'Instagram did not respond in time. Try again.'
            : error.reason === 'provider_unavailable'
              ? 'Instagram is temporarily unavailable. Try again later.'
              : 'Could not reach Instagram. Check the server network and try again.',
        );
      }
      throw error;
    }
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
            token_fingerprint, status, last_validated_at
          ) values (
            ${context.tenantId}, ${input.accountId}, ${encrypted.ciphertext},
            ${encrypted.iv}, ${encrypted.authTag}, ${encrypted.keyVersion},
            ${encrypted.fingerprint}, 'active', now()
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
            last_validated_at = now(),
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
            ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject},
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
          ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject},
          'instagram.connection.deleted', 'instagram_account', ${deleted.id},
          ${correlationId}, ${transaction.json({
            accountIdSuffix: deleted.accountId.slice(-4),
          })}
        )
      `;
    });
  }
}
