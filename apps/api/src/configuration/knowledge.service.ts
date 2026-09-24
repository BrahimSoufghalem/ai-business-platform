import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import {
  createKnowledgeGroundingEnvelope,
  type KnowledgeGroundingEnvelope,
} from '@ai-business/ai-gateway';
import { withTenantTransaction, type TenantTransaction } from '@ai-business/db';
import { DatabaseService } from '../database/database.service.js';
import { authorizeTenantPermission } from '../tenancy/tenant-authorization.js';
import { createCandidateTenantContext } from '../tenancy/trusted-tenant-context.js';
import type {
  CreateKnowledgeEntryInput,
  KnowledgeSearchInput,
  ListConfigurationInput,
  PublishKnowledgeVersionInput,
  SaveKnowledgeDraftInput,
} from './configuration.schemas.js';

type VersionStatus = 'draft' | 'published' | 'superseded';
type KnowledgeKind = 'faq' | 'article' | 'policy';

export interface KnowledgeVersionView {
  readonly id: string;
  readonly version: number;
  readonly status: VersionStatus;
  readonly title: string;
  readonly question: string | null;
  readonly content: string;
  readonly changeNote: string | null;
  readonly createdBy: string;
  readonly publishedBy: string | null;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

export interface KnowledgeEntryView {
  readonly id: string;
  readonly slug: string;
  readonly kind: KnowledgeKind;
  readonly version: number;
  readonly draft: KnowledgeVersionView | null;
  readonly published: KnowledgeVersionView | null;
  readonly history: readonly KnowledgeVersionView[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

@Injectable()
export class KnowledgeService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private async loadEntry(
    transaction: TenantTransaction,
    tenantId: string,
    entryId: string,
  ): Promise<KnowledgeEntryView | null> {
    const [entry] = await transaction<
      {
        id: string;
        slug: string;
        kind: KnowledgeKind;
        version: number;
        createdAt: Date;
        updatedAt: Date;
      }[]
    >`
      select
        id::text, slug, kind::text, version,
        created_at as "createdAt", updated_at as "updatedAt"
      from knowledge_entries
      where tenant_id = ${tenantId} and id = ${entryId}
      limit 1
    `;
    if (!entry) return null;
    const rows = await transaction<
      {
        id: string;
        version: number;
        status: VersionStatus;
        title: string;
        question: string | null;
        content: string;
        changeNote: string | null;
        createdBy: string;
        publishedBy: string | null;
        createdAt: Date;
        publishedAt: Date | null;
      }[]
    >`
      select
        id::text, version, status::text, title, question, content,
        change_note as "changeNote", created_by as "createdBy",
        published_by as "publishedBy", created_at as "createdAt",
        published_at as "publishedAt"
      from knowledge_versions
      where tenant_id = ${tenantId} and entry_id = ${entryId}
      order by version desc, id
      limit 100
    `;
    const history = rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      publishedAt: row.publishedAt?.toISOString() ?? null,
    }));
    return {
      ...entry,
      draft: history.find((version) => version.status === 'draft') ?? null,
      published: history.find((version) => version.status === 'published') ?? null,
      history,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    };
  }

  async list(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: ListConfigurationInput,
  ): Promise<KnowledgeEntryView[]> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'configuration:manage');
      const ids = await transaction<{ id: string }[]>`
        select id::text
        from knowledge_entries
        where tenant_id = ${context.tenantId}
        order by updated_at desc, id
        limit ${input.limit}
      `;
      const entries: KnowledgeEntryView[] = [];
      for (const { id } of ids) {
        const entry = await this.loadEntry(transaction, context.tenantId, id);
        if (entry) entries.push(entry);
      }
      return entries;
    });
  }

  async get(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    entryId: string,
  ): Promise<KnowledgeEntryView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'configuration:manage');
      const entry = await this.loadEntry(transaction, context.tenantId, entryId);
      if (!entry) throw new NotFoundException('Knowledge entry not found.');
      return entry;
    });
  }

  async create(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: CreateKnowledgeEntryInput,
  ): Promise<KnowledgeEntryView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    try {
      return await withTenantTransaction(this.database.client, context, async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'configuration:manage');
        const [created] = await transaction<{ id: string }[]>`
          insert into knowledge_entries (tenant_id, slug, kind)
          values (${context.tenantId}, ${input.slug}, ${input.kind})
          returning id::text
        `;
        if (!created) throw new Error('Knowledge entry insert returned no ID.');
        await transaction`
          insert into knowledge_versions (
            tenant_id, entry_id, version, status, title, question,
            content, change_note, created_by
          ) values (
            ${context.tenantId}, ${created.id}, 1, 'draft', ${input.title},
            ${input.question ?? null}, ${input.content}, ${input.changeNote ?? null},
            ${identity.subject}
          )
        `;
        await transaction`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action, entity_type,
            entity_id, correlation_id, metadata
          ) values (
            ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject}, 'knowledge.created',
            'knowledge_entry', ${created.id}, ${correlationId},
            ${transaction.json({ slug: input.slug, kind: input.kind, draftVersion: 1 })}
          )
        `;
        const entry = await this.loadEntry(transaction, context.tenantId, created.id);
        if (!entry) throw new Error('Created knowledge entry could not be loaded.');
        return entry;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A knowledge entry with this slug already exists.');
      }
      throw error;
    }
  }

  async saveDraft(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    entryId: string,
    input: SaveKnowledgeDraftInput,
  ): Promise<KnowledgeEntryView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'configuration:manage');
      const [current] = await transaction<{ version: number }[]>`
        select version
        from knowledge_entries
        where tenant_id = ${context.tenantId} and id = ${entryId}
        limit 1
        for update
      `;
      if (!current) throw new NotFoundException('Knowledge entry not found.');
      if (current.version !== input.expectedEntryVersion) {
        throw new ConflictException({
          message: 'Knowledge entry changed; reload before editing.',
          currentVersion: current.version,
        });
      }
      const [next] = await transaction<{ version: number }[]>`
        select coalesce(max(version), 0)::int + 1 as version
        from knowledge_versions
        where tenant_id = ${context.tenantId} and entry_id = ${entryId}
      `;
      if (!next) throw new Error('Next knowledge version could not be calculated.');
      await transaction`
        update knowledge_versions
        set status = 'superseded'
        where tenant_id = ${context.tenantId}
          and entry_id = ${entryId}
          and status = 'draft'
      `;
      await transaction`
        insert into knowledge_versions (
          tenant_id, entry_id, version, status, title, question,
          content, change_note, created_by
        ) values (
          ${context.tenantId}, ${entryId}, ${next.version}, 'draft',
          ${input.title}, ${input.question ?? null}, ${input.content},
          ${input.changeNote ?? null}, ${identity.subject}
        )
      `;
      await transaction`
        update knowledge_entries
        set version = version + 1, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${entryId}
      `;
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type,
          entity_id, correlation_id, metadata
        ) values (
          ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject}, 'knowledge.draft.saved',
          'knowledge_entry', ${entryId}, ${correlationId},
          ${transaction.json({ draftVersion: next.version })}
        )
      `;
      const entry = await this.loadEntry(transaction, context.tenantId, entryId);
      if (!entry) throw new Error('Updated knowledge entry could not be loaded.');
      return entry;
    });
  }

  async publish(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    entryId: string,
    versionId: string,
    input: PublishKnowledgeVersionInput,
  ): Promise<KnowledgeEntryView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'configuration:manage');
      const [current] = await transaction<{ version: number }[]>`
        select version
        from knowledge_entries
        where tenant_id = ${context.tenantId} and id = ${entryId}
        limit 1
        for update
      `;
      if (!current) throw new NotFoundException('Knowledge entry not found.');
      if (current.version !== input.expectedEntryVersion) {
        throw new ConflictException({
          message: 'Knowledge entry changed; reload before publishing.',
          currentVersion: current.version,
        });
      }
      const [target] = await transaction<{ version: number; status: VersionStatus }[]>`
        select version, status::text
        from knowledge_versions
        where tenant_id = ${context.tenantId}
          and entry_id = ${entryId}
          and id = ${versionId}
        limit 1
        for update
      `;
      if (!target) throw new NotFoundException('Knowledge version not found.');
      if (target.status !== 'draft') {
        throw new ConflictException('Only the current knowledge draft can be published.');
      }
      await transaction`
        update knowledge_versions
        set status = 'superseded'
        where tenant_id = ${context.tenantId}
          and entry_id = ${entryId}
          and status = 'published'
      `;
      await transaction`
        update knowledge_versions
        set
          status = 'published', published_by = ${identity.subject},
          published_at = now()
        where tenant_id = ${context.tenantId} and id = ${versionId}
      `;
      await transaction`
        update knowledge_entries
        set version = version + 1, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${entryId}
      `;
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type,
          entity_id, correlation_id, metadata
        ) values (
          ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject}, 'knowledge.published',
          'knowledge_version', ${versionId}, ${correlationId},
          ${transaction.json({ entryId, version: target.version })}
        )
      `;
      const entry = await this.loadEntry(transaction, context.tenantId, entryId);
      if (!entry) throw new Error('Published knowledge entry could not be loaded.');
      return entry;
    });
  }

  async searchPublished(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: KnowledgeSearchInput,
  ): Promise<KnowledgeGroundingEnvelope> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'configuration:read');
      const pattern = `%${input.q}%`;
      const rows = await transaction<
        {
          id: string;
          versionId: string;
          version: number;
          title: string;
          content: string;
        }[]
      >`
        select
          entry.id::text, version.id::text as "versionId",
          version.version, version.title, version.content
        from knowledge_entries as entry
        join knowledge_versions as version
          on version.tenant_id = entry.tenant_id
          and version.entry_id = entry.id
          and version.status = 'published'
        where entry.tenant_id = ${context.tenantId}
          and (
            ${input.kind ?? null}::knowledge_entry_kind is null
            or entry.kind = ${input.kind ?? null}::knowledge_entry_kind
          )
          and (
            version.title ilike ${pattern}
            or coalesce(version.question, '') ilike ${pattern}
            or version.content ilike ${pattern}
          )
        order by
          case
            when version.title ilike ${pattern} then 0
            when coalesce(version.question, '') ilike ${pattern} then 1
            else 2
          end,
          version.published_at desc,
          entry.id
        limit ${input.limit}
      `;
      return createKnowledgeGroundingEnvelope(rows);
    });
  }
}
