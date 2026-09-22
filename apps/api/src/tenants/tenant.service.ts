import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import type { MembershipRole } from '@ai-business/domain';
import { withIdentityTransaction, withTenantTransaction } from '@ai-business/db';
import { createCandidateTenantContext } from '../tenancy/trusted-tenant-context.js';
import { authorizeTenantPermission } from '../tenancy/tenant-authorization.js';
import { DatabaseService } from '../database/database.service.js';
import type { CreateTenantInput } from './tenant.schemas.js';

export interface TenantSummary {
  readonly id: string;
  readonly name: string;
  readonly role: MembershipRole;
  readonly status: string;
  readonly membershipCreatedAt: string;
}

export interface AuditEventSummary {
  readonly id: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

@Injectable()
export class TenantService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async list(identity: VerifiedIdentity, correlationId: string): Promise<TenantSummary[]> {
    const rows = await withIdentityTransaction(
      this.database.client,
      { identitySubject: identity.subject, correlationId },
      (transaction) =>
        transaction<
          {
            id: string;
            name: string;
            role: MembershipRole;
            status: string;
            membershipCreatedAt: Date;
          }[]
        >`
          select
            tenant_id::text as id,
            tenant_name as name,
            membership_role as role,
            membership_status as status,
            membership_created_at as "membershipCreatedAt"
          from app_list_current_identity_memberships()
        `,
    );

    return rows.map((row) => ({
      ...row,
      membershipCreatedAt: row.membershipCreatedAt.toISOString(),
    }));
  }

  async create(
    identity: VerifiedIdentity,
    correlationId: string,
    input: CreateTenantInput,
  ): Promise<TenantSummary> {
    const tenantId = await withIdentityTransaction(
      this.database.client,
      { identitySubject: identity.subject, correlationId },
      async (transaction) => {
        const [row] = await transaction<{ id: string }[]>`
          select app_provision_tenant(
            ${input.name},
            ${identity.email ?? ''},
            ${input.locale},
            ${input.timezone}
          )::text as id
        `;
        if (!row) throw new Error('Tenant provisioning did not return an ID.');
        return row.id;
      },
    );

    const memberships = await this.list(identity, correlationId);
    const created = memberships.find((membership) => membership.id === tenantId);
    if (!created) throw new Error('Provisioned tenant was not visible to its owner.');
    return created;
  }

  async get(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
  ): Promise<{ id: string; name: string; locale: string; timezone: string; status: string }> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    const [tenant] = await withTenantTransaction(
      this.database.client,
      context,
      (transaction) =>
        transaction<
          { id: string; name: string; locale: string; timezone: string; status: string }[]
        >`
        select id::text, name, locale, timezone, status::text
        from tenants
        where id = ${context.tenantId}
        limit 1
      `,
    );

    if (!tenant) throw new NotFoundException('Tenant not found.');
    return tenant;
  }

  async listAuditEvents(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
  ): Promise<AuditEventSummary[]> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);

    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'audit:read');

      const rows = await transaction<
        {
          id: string;
          action: string;
          entityType: string;
          entityId: string;
          actorId: string;
          correlationId: string;
          createdAt: Date;
        }[]
      >`
        select
          id::text, action, entity_type as "entityType", entity_id as "entityId",
          actor_id as "actorId", correlation_id as "correlationId",
          created_at as "createdAt"
        from audit_events
        where tenant_id = ${context.tenantId}
        order by created_at desc
        limit 50
      `;

      return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
    });
  }
}
