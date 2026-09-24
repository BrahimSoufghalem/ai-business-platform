import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import {
  evaluatePriceDecision,
  normalizePricingPolicy,
  type PriceDecision,
  type PricingPolicy,
} from '@ai-business/domain';
import { withTenantTransaction, type TenantTransaction } from '@ai-business/db';
import { DatabaseService } from '../database/database.service.js';
import { authorizeTenantPermission } from '../tenancy/tenant-authorization.js';
import { createCandidateTenantContext } from '../tenancy/trusted-tenant-context.js';
import type {
  CreateRuleSetInput,
  EvaluatePriceInput,
  ListConfigurationInput,
  PublishRuleVersionInput,
  SaveRuleDraftInput,
} from './configuration.schemas.js';

type VersionStatus = 'draft' | 'published' | 'superseded';
type JsonInput = Parameters<TenantTransaction['json']>[0];

export interface BusinessRuleVersionView {
  readonly id: string;
  readonly version: number;
  readonly status: VersionStatus;
  readonly policy: PricingPolicy;
  readonly changeNote: string | null;
  readonly createdBy: string;
  readonly publishedBy: string | null;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

export interface BusinessRuleSetView {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly version: number;
  readonly draft: BusinessRuleVersionView | null;
  readonly published: BusinessRuleVersionView | null;
  readonly history: readonly BusinessRuleVersionView[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PersistedPriceDecision extends PriceDecision {
  readonly id: string;
  readonly productId: string | null;
  readonly variantId: string | null;
  readonly conversationId: string | null;
  readonly createdAt: string;
}

export interface PublishedBusinessRuleSetView {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly published: {
    readonly id: string;
    readonly version: number;
    readonly policy: PricingPolicy;
    readonly publishedAt: string;
  };
}

function jsonInput(value: unknown): JsonInput {
  return value as JsonInput;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

@Injectable()
export class BusinessRuleService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private normalizePolicy(input: PricingPolicy): PricingPolicy {
    try {
      return normalizePricingPolicy(input);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid policy.');
    }
  }

  private async loadRuleSet(
    transaction: TenantTransaction,
    tenantId: string,
    ruleSetId: string,
  ): Promise<BusinessRuleSetView | null> {
    const [set] = await transaction<
      {
        id: string;
        key: string;
        name: string;
        description: string | null;
        version: number;
        createdAt: Date;
        updatedAt: Date;
      }[]
    >`
      select
        id::text, key, name, description, version,
        created_at as "createdAt", updated_at as "updatedAt"
      from business_rule_sets
      where tenant_id = ${tenantId} and id = ${ruleSetId}
      limit 1
    `;
    if (!set) return null;
    const rows = await transaction<
      {
        id: string;
        version: number;
        status: VersionStatus;
        policy: PricingPolicy;
        changeNote: string | null;
        createdBy: string;
        publishedBy: string | null;
        createdAt: Date;
        publishedAt: Date | null;
      }[]
    >`
      select
        id::text, version, status::text, policy,
        change_note as "changeNote", created_by as "createdBy",
        published_by as "publishedBy", created_at as "createdAt",
        published_at as "publishedAt"
      from business_rule_versions
      where tenant_id = ${tenantId} and rule_set_id = ${ruleSetId}
      order by version desc, id
      limit 100
    `;
    const history = rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      publishedAt: row.publishedAt?.toISOString() ?? null,
    }));
    return {
      ...set,
      draft: history.find((version) => version.status === 'draft') ?? null,
      published: history.find((version) => version.status === 'published') ?? null,
      history,
      createdAt: set.createdAt.toISOString(),
      updatedAt: set.updatedAt.toISOString(),
    };
  }

  async list(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: ListConfigurationInput,
  ): Promise<BusinessRuleSetView[]> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'configuration:manage');
      const ids = await transaction<{ id: string }[]>`
        select id::text
        from business_rule_sets
        where tenant_id = ${context.tenantId}
        order by updated_at desc, id
        limit ${input.limit}
      `;
      const sets: BusinessRuleSetView[] = [];
      for (const { id } of ids) {
        const set = await this.loadRuleSet(transaction, context.tenantId, id);
        if (set) sets.push(set);
      }
      return sets;
    });
  }

  async listPublished(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    limit = 20,
  ): Promise<PublishedBusinessRuleSetView[]> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'configuration:read');
      const safeLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 20) : 20;
      const rows = await transaction<
        {
          id: string;
          key: string;
          name: string;
          description: string | null;
          versionId: string;
          version: number;
          policy: PricingPolicy;
          publishedAt: Date;
        }[]
      >`
        select
          rule_set.id::text, rule_set.key, rule_set.name, rule_set.description,
          version.id::text as "versionId", version.version, version.policy,
          version.published_at as "publishedAt"
        from business_rule_sets as rule_set
        join business_rule_versions as version
          on version.tenant_id = rule_set.tenant_id
          and version.rule_set_id = rule_set.id
          and version.status = 'published'
        where rule_set.tenant_id = ${context.tenantId}
        order by
          case when rule_set.key = 'default-pricing' then 0 else 1 end,
          rule_set.key,
          rule_set.id
        limit ${safeLimit}
      `;
      return rows.map((row) => ({
        id: row.id,
        key: row.key,
        name: row.name,
        description: row.description,
        published: {
          id: row.versionId,
          version: row.version,
          policy: row.policy,
          publishedAt: row.publishedAt.toISOString(),
        },
      }));
    });
  }

  async get(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    ruleSetId: string,
  ): Promise<BusinessRuleSetView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'configuration:manage');
      const set = await this.loadRuleSet(transaction, context.tenantId, ruleSetId);
      if (!set) throw new NotFoundException('Business rule set not found.');
      return set;
    });
  }

  async create(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: CreateRuleSetInput,
  ): Promise<BusinessRuleSetView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    const policy = this.normalizePolicy(input.policy);
    try {
      return await withTenantTransaction(this.database.client, context, async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'configuration:manage');
        const [created] = await transaction<{ id: string }[]>`
          insert into business_rule_sets (tenant_id, key, name, description)
          values (
            ${context.tenantId}, ${input.key}, ${input.name}, ${input.description ?? null}
          )
          returning id::text
        `;
        if (!created) throw new Error('Business rule set insert returned no ID.');
        await transaction`
          insert into business_rule_versions (
            tenant_id, rule_set_id, version, status, policy,
            change_note, created_by
          ) values (
            ${context.tenantId}, ${created.id}, 1, 'draft',
            ${transaction.json(jsonInput(policy))}, ${input.changeNote ?? null},
            ${identity.subject}
          )
        `;
        await transaction`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action, entity_type,
            entity_id, correlation_id, metadata
          ) values (
            ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject}, 'business_rule.created',
            'business_rule_set', ${created.id}, ${correlationId},
            ${transaction.json({ key: input.key, draftVersion: 1 })}
          )
        `;
        const set = await this.loadRuleSet(transaction, context.tenantId, created.id);
        if (!set) throw new Error('Created business rule set could not be loaded.');
        return set;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A business rule set with this key already exists.');
      }
      throw error;
    }
  }

  async saveDraft(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    ruleSetId: string,
    input: SaveRuleDraftInput,
  ): Promise<BusinessRuleSetView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    const policy = this.normalizePolicy(input.policy);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'configuration:manage');
      const [current] = await transaction<{ version: number }[]>`
        select version
        from business_rule_sets
        where tenant_id = ${context.tenantId} and id = ${ruleSetId}
        limit 1
        for update
      `;
      if (!current) throw new NotFoundException('Business rule set not found.');
      if (current.version !== input.expectedSetVersion) {
        throw new ConflictException({
          message: 'Business rule set changed; reload before editing.',
          currentVersion: current.version,
        });
      }
      const [next] = await transaction<{ version: number }[]>`
        select coalesce(max(version), 0)::int + 1 as version
        from business_rule_versions
        where tenant_id = ${context.tenantId} and rule_set_id = ${ruleSetId}
      `;
      if (!next) throw new Error('Next business rule version could not be calculated.');
      await transaction`
        update business_rule_versions
        set status = 'superseded'
        where tenant_id = ${context.tenantId}
          and rule_set_id = ${ruleSetId}
          and status = 'draft'
      `;
      await transaction`
        insert into business_rule_versions (
          tenant_id, rule_set_id, version, status, policy,
          change_note, created_by
        ) values (
          ${context.tenantId}, ${ruleSetId}, ${next.version}, 'draft',
          ${transaction.json(jsonInput(policy))}, ${input.changeNote ?? null},
          ${identity.subject}
        )
      `;
      await transaction`
        update business_rule_sets
        set version = version + 1, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${ruleSetId}
      `;
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type,
          entity_id, correlation_id, metadata
        ) values (
          ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject}, 'business_rule.draft.saved',
          'business_rule_set', ${ruleSetId}, ${correlationId},
          ${transaction.json({ draftVersion: next.version })}
        )
      `;
      const set = await this.loadRuleSet(transaction, context.tenantId, ruleSetId);
      if (!set) throw new Error('Updated business rule set could not be loaded.');
      return set;
    });
  }

  async publish(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    ruleSetId: string,
    versionId: string,
    input: PublishRuleVersionInput,
  ): Promise<BusinessRuleSetView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'configuration:manage');
      const [current] = await transaction<{ version: number }[]>`
        select version
        from business_rule_sets
        where tenant_id = ${context.tenantId} and id = ${ruleSetId}
        limit 1
        for update
      `;
      if (!current) throw new NotFoundException('Business rule set not found.');
      if (current.version !== input.expectedSetVersion) {
        throw new ConflictException({
          message: 'Business rule set changed; reload before publishing.',
          currentVersion: current.version,
        });
      }
      const [target] = await transaction<{ version: number; status: VersionStatus }[]>`
        select version, status::text
        from business_rule_versions
        where tenant_id = ${context.tenantId}
          and rule_set_id = ${ruleSetId}
          and id = ${versionId}
        limit 1
        for update
      `;
      if (!target) throw new NotFoundException('Business rule version not found.');
      if (target.status !== 'draft') {
        throw new ConflictException('Only the current draft can be published.');
      }
      await transaction`
        update business_rule_versions
        set status = 'superseded'
        where tenant_id = ${context.tenantId}
          and rule_set_id = ${ruleSetId}
          and status = 'published'
      `;
      await transaction`
        update business_rule_versions
        set
          status = 'published', published_by = ${identity.subject},
          published_at = now()
        where tenant_id = ${context.tenantId} and id = ${versionId}
      `;
      await transaction`
        update business_rule_sets
        set version = version + 1, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${ruleSetId}
      `;
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type,
          entity_id, correlation_id, metadata
        ) values (
          ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject}, 'business_rule.published',
          'business_rule_version', ${versionId}, ${correlationId},
          ${transaction.json({ ruleSetId, version: target.version })}
        )
      `;
      const set = await this.loadRuleSet(transaction, context.tenantId, ruleSetId);
      if (!set) throw new Error('Published business rule set could not be loaded.');
      return set;
    });
  }

  private async validateDecisionLinks(
    transaction: TenantTransaction,
    tenantId: string,
    input: EvaluatePriceInput,
  ): Promise<void> {
    if (input.productId) {
      const [product] = await transaction<{ id: string }[]>`
        select id::text from products
        where tenant_id = ${tenantId} and id = ${input.productId}
        limit 1
      `;
      if (!product) throw new NotFoundException('Decision product not found.');
    }
    if (input.variantId) {
      const [variant] = await transaction<{ id: string; productId: string }[]>`
        select id::text, product_id::text as "productId"
        from product_variants
        where tenant_id = ${tenantId} and id = ${input.variantId}
        limit 1
      `;
      if (!variant) throw new NotFoundException('Decision variant not found.');
      if (input.productId && variant.productId !== input.productId) {
        throw new BadRequestException('Decision variant does not belong to the product.');
      }
    }
    if (input.conversationId) {
      const [conversation] = await transaction<{ id: string }[]>`
        select id::text from conversations
        where tenant_id = ${tenantId} and id = ${input.conversationId}
        limit 1
      `;
      if (!conversation) throw new NotFoundException('Decision conversation not found.');
    }
  }

  async evaluate(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    ruleSetId: string,
    input: EvaluatePriceInput,
  ): Promise<PersistedPriceDecision> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'configuration:read');
      const [published] = await transaction<
        { id: string; version: number; policy: PricingPolicy }[]
      >`
        select id::text, version, policy
        from business_rule_versions
        where tenant_id = ${context.tenantId}
          and rule_set_id = ${ruleSetId}
          and status = 'published'
        limit 1
      `;
      if (!published) {
        throw new ConflictException('A published business rule is required for pricing.');
      }
      await this.validateDecisionLinks(transaction, context.tenantId, input);
      let decision: PriceDecision;
      try {
        decision = evaluatePriceDecision(
          published.policy,
          {
            ruleSetId,
            ruleVersionId: published.id,
            version: published.version,
          },
          input,
        );
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : 'Price decision is invalid.',
        );
      }
      const [created] = await transaction<{ id: string; createdAt: Date }[]>`
        insert into pricing_decisions (
          tenant_id, rule_set_id, rule_version_id, rule_version,
          product_id, variant_id, conversation_id, currency, list_price,
          requested_price, decided_price, outcome, reason, correlation_id
        ) values (
          ${context.tenantId}, ${ruleSetId}, ${published.id}, ${published.version},
          ${input.productId ?? null}, ${input.variantId ?? null},
          ${input.conversationId ?? null},
          ${decision.currency}, ${decision.listPrice}, ${decision.requestedPrice},
          ${decision.decidedPrice}, ${decision.outcome}, ${decision.reason},
          ${correlationId}
        )
        returning id::text, created_at as "createdAt"
      `;
      if (!created) throw new Error('Pricing decision insert returned no row.');
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type,
          entity_id, correlation_id, metadata
        ) values (
          ${context.tenantId}, ${identity.actorType ?? 'user'}, ${identity.subject}, 'pricing.decision.created',
          'pricing_decision', ${created.id}, ${correlationId},
          ${transaction.json({
            ruleSetId,
            ruleVersionId: published.id,
            ruleVersion: published.version,
            outcome: decision.outcome,
          })}
        )
      `;
      return {
        ...decision,
        id: created.id,
        productId: input.productId ?? null,
        variantId: input.variantId ?? null,
        conversationId: input.conversationId ?? null,
        createdAt: created.createdAt.toISOString(),
      };
    });
  }
}
