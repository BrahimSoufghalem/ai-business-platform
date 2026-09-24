import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { normalizeAgentSettings, type AgentLanguage, type AgentTone } from '@ai-business/domain';
import { withTenantTransaction, type TenantTransaction } from '@ai-business/db';
import { DatabaseService } from '../database/database.service.js';
import { authorizeTenantPermission } from '../tenancy/tenant-authorization.js';
import { createCandidateTenantContext } from '../tenancy/trusted-tenant-context.js';
import type {
  PublishAgentSettingsInput,
  SaveAgentSettingsDraftInput,
} from './configuration.schemas.js';

type VersionStatus = 'draft' | 'published' | 'superseded';

export interface AgentSettingsVersionView {
  readonly id: string;
  readonly version: number;
  readonly status: VersionStatus;
  readonly language: AgentLanguage;
  readonly tone: AgentTone;
  readonly handoffNotes: string;
  readonly changeNote: string | null;
  readonly createdBy: string;
  readonly publishedBy: string | null;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

export interface AgentSettingsHistoryView {
  readonly latestVersion: number;
  readonly draft: AgentSettingsVersionView | null;
  readonly published: AgentSettingsVersionView | null;
  readonly history: readonly AgentSettingsVersionView[];
}

export interface AgentRuntimeSettingsView {
  readonly id: string;
  readonly version: number;
  readonly language: AgentLanguage;
  readonly tone: AgentTone;
  readonly handoff: {
    readonly trust: 'untrusted_content';
    readonly notes: string;
  };
}

@Injectable()
export class AgentSettingsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private async loadHistory(
    transaction: TenantTransaction,
    tenantId: string,
  ): Promise<AgentSettingsHistoryView> {
    const rows = await transaction<
      {
        id: string;
        version: number;
        status: VersionStatus;
        language: AgentLanguage;
        tone: AgentTone;
        handoffNotes: string;
        changeNote: string | null;
        createdBy: string;
        publishedBy: string | null;
        createdAt: Date;
        publishedAt: Date | null;
      }[]
    >`
      select
        id::text, version, status::text, language, tone::text,
        handoff_notes as "handoffNotes", change_note as "changeNote",
        created_by as "createdBy", published_by as "publishedBy",
        created_at as "createdAt", published_at as "publishedAt"
      from agent_settings_versions
      where tenant_id = ${tenantId}
      order by version desc, id
      limit 100
    `;
    const history = rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      publishedAt: row.publishedAt?.toISOString() ?? null,
    }));
    return {
      latestVersion: history[0]?.version ?? 0,
      draft: history.find((version) => version.status === 'draft') ?? null,
      published: history.find((version) => version.status === 'published') ?? null,
      history,
    };
  }

  async history(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
  ): Promise<AgentSettingsHistoryView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'configuration:manage');
      return this.loadHistory(transaction, context.tenantId);
    });
  }

  async published(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
  ): Promise<AgentRuntimeSettingsView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'configuration:read');
      const [settings] = await transaction<
        {
          id: string;
          version: number;
          language: AgentLanguage;
          tone: AgentTone;
          handoffNotes: string;
        }[]
      >`
        select
          id::text, version, language, tone::text,
          handoff_notes as "handoffNotes"
        from agent_settings_versions
        where tenant_id = ${context.tenantId} and status = 'published'
        limit 1
      `;
      if (!settings) throw new NotFoundException('Published agent settings not found.');
      return {
        id: settings.id,
        version: settings.version,
        language: settings.language,
        tone: settings.tone,
        handoff: {
          trust: 'untrusted_content',
          notes: settings.handoffNotes,
        },
      };
    });
  }

  async saveDraft(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: SaveAgentSettingsDraftInput,
  ): Promise<AgentSettingsHistoryView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    let settings;
    try {
      settings = normalizeAgentSettings(input);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Agent settings are invalid.',
      );
    }
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'configuration:manage');
      await transaction`
        select pg_advisory_xact_lock(
          hashtextextended(${`${context.tenantId}:agent-settings`}, 0::bigint)
        )
      `;
      const [latest] = await transaction<{ version: number }[]>`
        select coalesce(max(version), 0)::int as version
        from agent_settings_versions
        where tenant_id = ${context.tenantId}
      `;
      const latestVersion = latest?.version ?? 0;
      if (latestVersion !== input.expectedLatestVersion) {
        throw new ConflictException({
          message: 'Agent settings changed; reload before editing.',
          currentVersion: latestVersion,
        });
      }
      await transaction`
        update agent_settings_versions
        set status = 'superseded'
        where tenant_id = ${context.tenantId} and status = 'draft'
      `;
      const nextVersion = latestVersion + 1;
      await transaction`
        insert into agent_settings_versions (
          tenant_id, version, status, language, tone, handoff_notes,
          change_note, created_by
        ) values (
          ${context.tenantId}, ${nextVersion}, 'draft', ${settings.language},
          ${settings.tone}, ${settings.handoffNotes}, ${input.changeNote ?? null},
          ${identity.subject}
        )
      `;
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type,
          entity_id, correlation_id, metadata
        )
        select
          ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject},
          'agent_settings.draft.saved', 'agent_settings_version',
          id::text, ${correlationId}, ${transaction.json({ version: nextVersion })}
        from agent_settings_versions
        where tenant_id = ${context.tenantId}
          and version = ${nextVersion}
      `;
      return this.loadHistory(transaction, context.tenantId);
    });
  }

  async publish(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    versionId: string,
    input: PublishAgentSettingsInput,
  ): Promise<AgentSettingsHistoryView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'configuration:manage');
      await transaction`
        select pg_advisory_xact_lock(
          hashtextextended(${`${context.tenantId}:agent-settings`}, 0::bigint)
        )
      `;
      const [latest] = await transaction<{ version: number }[]>`
        select coalesce(max(version), 0)::int as version
        from agent_settings_versions
        where tenant_id = ${context.tenantId}
      `;
      const latestVersion = latest?.version ?? 0;
      if (latestVersion !== input.expectedLatestVersion) {
        throw new ConflictException({
          message: 'Agent settings changed; reload before publishing.',
          currentVersion: latestVersion,
        });
      }
      const [target] = await transaction<{ version: number; status: VersionStatus }[]>`
        select version, status::text
        from agent_settings_versions
        where tenant_id = ${context.tenantId} and id = ${versionId}
        limit 1
        for update
      `;
      if (!target) throw new NotFoundException('Agent settings version not found.');
      if (target.status !== 'draft' || target.version !== latestVersion) {
        throw new ConflictException('Only the latest agent settings draft can be published.');
      }
      await transaction`
        update agent_settings_versions
        set status = 'superseded'
        where tenant_id = ${context.tenantId} and status = 'published'
      `;
      await transaction`
        update agent_settings_versions
        set
          status = 'published', published_by = ${identity.subject},
          published_at = now()
        where tenant_id = ${context.tenantId} and id = ${versionId}
      `;
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type,
          entity_id, correlation_id, metadata
        ) values (
          ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject}, 'agent_settings.published',
          'agent_settings_version', ${versionId}, ${correlationId},
          ${transaction.json({ version: target.version })}
        )
      `;
      return this.loadHistory(transaction, context.tenantId);
    });
  }
}
