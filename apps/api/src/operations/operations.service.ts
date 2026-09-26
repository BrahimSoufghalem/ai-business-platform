import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { withTenantTransaction, type TenantTransaction } from '@ai-business/db';
import { DatabaseService } from '../database/database.service.js';
import { authorizeTenantPermission } from '../tenancy/tenant-authorization.js';
import { createCandidateTenantContext } from '../tenancy/trusted-tenant-context.js';
import type { AlertQuery, DashboardQuery } from './operations.schemas.js';

const daysByRange = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
} as const;

type AlertSeverity = 'warning' | 'critical';
type AlertKind = 'low_stock' | 'handoff_wait' | 'ai_tool_failure';

export interface OperationsAlert {
  readonly id: string;
  readonly kind: AlertKind;
  readonly severity: AlertSeverity;
  readonly title: string;
  readonly detail: string;
  readonly data: Readonly<Record<string, string | number | null>>;
  readonly entityId: string;
  readonly correlationId: string | null;
  readonly occurredAt: string;
}

export interface OperationsDashboard {
  readonly range: DashboardQuery['range'];
  readonly generatedAt: string;
  readonly timezone: string;
  readonly orders: {
    readonly total: number;
    readonly active: number;
    readonly delivered: number;
    readonly cancelled: number;
    readonly byStatus: readonly { status: string; count: number }[];
  };
  readonly salesByCurrency: readonly { currency: string; amount: string; orderCount: number }[];
  readonly stock: {
    readonly alertCount: number;
    readonly outOfStockCount: number;
  };
  readonly handoffs: {
    readonly pending: number;
    readonly active: number;
    readonly resolved: number;
    readonly averageFirstResponseSeconds: number | null;
    readonly averageResolutionSeconds: number | null;
  };
  readonly ai: {
    readonly runCount: number;
    readonly handoffCount: number;
    readonly handoffRate: number;
    readonly averageLatencyMs: number;
    readonly p95LatencyMs: number;
    readonly estimatedCostUsd: string;
    readonly failedToolCalls: number;
  };
  readonly daily: readonly {
    readonly date: string;
    readonly orders: number;
    readonly handoffs: number;
    readonly aiRuns: number;
  }[];
  readonly alerts: readonly OperationsAlert[];
}

export interface CorrelationTrace {
  readonly correlationId: string;
  readonly messages: readonly {
    id: string;
    conversationId: string;
    direction: string;
    senderType: string;
    createdAt: string;
  }[];
  readonly aiRuns: readonly {
    id: string;
    conversationId: string | null;
    task: string;
    intent: string;
    outcome: string;
    provider: string | null;
    model: string | null;
    latencyMs: number;
    estimatedCostUsd: string;
    createdAt: string;
  }[];
  readonly toolCalls: readonly {
    id: string;
    runId: string;
    name: string;
    kind: string;
    status: string;
    latencyMs: number;
    errorCode: string | null;
    createdAt: string;
  }[];
  readonly orders: readonly {
    id: string;
    number: string;
    status: string;
    total: string;
    currency: string;
    createdAt: string;
  }[];
  readonly handoffs: readonly {
    id: string;
    conversationId: string;
    sourceRunId: string;
    reason: string;
    status: string;
    requestedAt: string;
    resolvedAt: string | null;
  }[];
  readonly auditEvents: readonly {
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    createdAt: string;
  }[];
  readonly timeline: readonly {
    kind: 'message' | 'ai_run' | 'tool_call' | 'order' | 'handoff' | 'audit';
    id: string;
    label: string;
    occurredAt: string;
  }[];
}

function positiveEnvironmentInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function iso(value: Date): string {
  return value.toISOString();
}

@Injectable()
export class OperationsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private async loadAlerts(
    transaction: TenantTransaction,
    tenantId: string,
    days: number,
    limit: number,
  ): Promise<OperationsAlert[]> {
    const handoffWarningSeconds = positiveEnvironmentInteger(
      'PILOT_HANDOFF_WAIT_ALERT_SECONDS',
      15 * 60,
    );
    const lowStockRows = await transaction<
      {
        id: string;
        productName: string;
        variantName: string | null;
        sku: string;
        locationName: string;
        available: number;
        reorderPoint: number;
        updatedAt: Date;
      }[]
    >`
      select
        balance.id::text,
        product.name as "productName",
        variant.name as "variantName",
        variant.sku,
        location.name as "locationName",
        (balance.on_hand - balance.reserved)::int as available,
        balance.reorder_point as "reorderPoint",
        balance.updated_at as "updatedAt"
      from inventory_balances as balance
      join product_variants as variant
        on variant.tenant_id = balance.tenant_id
        and variant.id = balance.variant_id
      join products as product
        on product.tenant_id = variant.tenant_id
        and product.id = variant.product_id
      join inventory_locations as location
        on location.tenant_id = balance.tenant_id
        and location.id = balance.location_id
      where balance.tenant_id = ${tenantId}
        and variant.status = 'active'
        and product.status = 'active'
        and location.status = 'active'
        and balance.on_hand - balance.reserved <= balance.reorder_point
      order by available, balance.updated_at desc
      limit ${limit}
    `;
    const handoffRows = await transaction<
      {
        id: string;
        conversationId: string;
        waitSeconds: number;
        requestedAt: Date;
      }[]
    >`
      select
        id::text,
        conversation_id::text as "conversationId",
        greatest(0, floor(extract(epoch from (now() - requested_at))))::int as "waitSeconds",
        requested_at as "requestedAt"
      from handoffs
      where tenant_id = ${tenantId}
        and status = 'pending'
        and requested_at <= now() - (${handoffWarningSeconds} * interval '1 second')
      order by requested_at
      limit ${limit}
    `;
    const toolFailureRows = await transaction<
      {
        id: string;
        runId: string;
        name: string;
        kind: string;
        status: string;
        errorCode: string;
        correlationId: string;
        createdAt: Date;
      }[]
    >`
      select
        tool.id::text,
        tool.run_id::text as "runId",
        tool.name,
        tool.kind::text,
        tool.status::text,
        tool.error_code as "errorCode",
        run.correlation_id as "correlationId",
        tool.created_at as "createdAt"
      from ai_tool_calls as tool
      join ai_runs as run
        on run.tenant_id = tool.tenant_id
        and run.id = tool.run_id
      where tool.tenant_id = ${tenantId}
        and tool.status in ('failed', 'rejected')
        and tool.created_at >= now() - (${days} * interval '1 day')
      order by tool.created_at desc
      limit ${limit}
    `;

    return [
      ...lowStockRows.map((row): OperationsAlert => ({
        id: `low-stock:${row.id}`,
        kind: 'low_stock',
        severity: row.available === 0 ? 'critical' : 'warning',
        title: row.available === 0 ? 'نفد المخزون' : 'تنبيه مخزون منخفض',
        detail: `${row.productName} · ${row.variantName ?? row.sku} · ${row.locationName} — المتاح ${row.available}، حد إعادة الطلب ${row.reorderPoint}`,
        data: {
          productName: row.productName,
          variantName: row.variantName,
          sku: row.sku,
          locationName: row.locationName,
          available: row.available,
          reorderPoint: row.reorderPoint,
        },
        entityId: row.id,
        correlationId: null,
        occurredAt: iso(row.updatedAt),
      })),
      ...handoffRows.map((row): OperationsAlert => ({
        id: `handoff-wait:${row.id}`,
        kind: 'handoff_wait',
        severity: row.waitSeconds >= handoffWarningSeconds * 2 ? 'critical' : 'warning',
        title: 'تحويل ينتظر موظفًا',
        detail: `المحادثة تنتظر منذ ${Math.floor(row.waitSeconds / 60)} دقيقة.`,
        data: { waitMinutes: Math.floor(row.waitSeconds / 60) },
        entityId: row.conversationId,
        correlationId: null,
        occurredAt: iso(row.requestedAt),
      })),
      ...toolFailureRows.map((row): OperationsAlert => ({
        id: `tool-failure:${row.id}`,
        kind: 'ai_tool_failure',
        severity: row.kind === 'command' ? 'critical' : 'warning',
        title: row.status === 'rejected' ? 'رفض استدعاء أداة' : 'فشل استدعاء أداة',
        detail: `${row.name} — ${row.errorCode}`,
        data: { name: row.name, errorCode: row.errorCode, status: row.status },
        entityId: row.runId,
        correlationId: row.correlationId,
        occurredAt: iso(row.createdAt),
      })),
    ]
      .sort((left, right) => {
        if (left.severity !== right.severity) return left.severity === 'critical' ? -1 : 1;
        return right.occurredAt.localeCompare(left.occurredAt);
      })
      .slice(0, limit);
  }

  async getDashboard(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    query: DashboardQuery,
  ): Promise<OperationsDashboard> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    const days = daysByRange[query.range];
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'audit:read');
      const [tenant] = await transaction<{ timezone: string }[]>`
        select timezone
        from tenants
        where id = ${context.tenantId}
        limit 1
      `;
      if (!tenant) throw new NotFoundException('Tenant not found.');

      const [orderTotals] = await transaction<
        {
          total: number;
          active: number;
          delivered: number;
          cancelled: number;
        }[]
      >`
        select
          count(*)::int as total,
          count(*) filter (
            where status in ('new', 'confirmed', 'preparing', 'shipped')
          )::int as active,
          count(*) filter (where status = 'delivered')::int as delivered,
          count(*) filter (where status = 'cancelled')::int as cancelled
        from orders
        where tenant_id = ${context.tenantId}
          and created_at >= now() - (${days} * interval '1 day')
      `;
      const orderStatusRows = await transaction<{ status: string; count: number }[]>`
        select status::text, count(*)::int
        from orders
        where tenant_id = ${context.tenantId}
          and created_at >= now() - (${days} * interval '1 day')
        group by status
        order by status
      `;
      const salesByCurrency = await transaction<
        { currency: string; amount: string; orderCount: number }[]
      >`
        select
          currency,
          coalesce(sum(total) filter (where status <> 'cancelled'), 0)::text as amount,
          count(*) filter (where status <> 'cancelled')::int as "orderCount"
        from orders
        where tenant_id = ${context.tenantId}
          and created_at >= now() - (${days} * interval '1 day')
        group by currency
        order by currency
      `;
      const [stock] = await transaction<{ alertCount: number; outOfStockCount: number }[]>`
        select
          count(*) filter (
            where on_hand - reserved <= reorder_point
          )::int as "alertCount",
          count(*) filter (
            where on_hand - reserved = 0
          )::int as "outOfStockCount"
        from inventory_balances
        where tenant_id = ${context.tenantId}
      `;
      const [handoffs] = await transaction<
        {
          pending: number;
          active: number;
          resolved: number;
          averageFirstResponseSeconds: number | null;
          averageResolutionSeconds: number | null;
        }[]
      >`
        select
          count(*) filter (where status = 'pending')::int as pending,
          count(*) filter (where status = 'active')::int as active,
          count(*) filter (where status = 'resolved')::int as resolved,
          round(avg(extract(epoch from (first_claimed_at - requested_at)))
            filter (where first_claimed_at is not null))::int
            as "averageFirstResponseSeconds",
          round(avg(extract(epoch from (resolved_at - requested_at)))
            filter (where resolved_at is not null))::int
            as "averageResolutionSeconds"
        from handoffs
        where tenant_id = ${context.tenantId}
          and requested_at >= now() - (${days} * interval '1 day')
      `;
      const [ai] = await transaction<
        {
          runCount: number;
          handoffCount: number;
          averageLatencyMs: number;
          p95LatencyMs: number;
          estimatedCostUsd: string;
          failedToolCalls: number;
        }[]
      >`
        select
          count(*)::int as "runCount",
          count(*) filter (where run.outcome = 'handoff')::int as "handoffCount",
          coalesce(avg(run.latency_ms), 0)::float8 as "averageLatencyMs",
          coalesce(
            percentile_cont(0.95) within group (order by run.latency_ms),
            0
          )::float8 as "p95LatencyMs",
          coalesce(sum(run.estimated_cost_usd), 0)::text as "estimatedCostUsd",
          (
            select count(*)::int
            from ai_tool_calls as tool
            where tool.tenant_id = ${context.tenantId}
              and tool.status in ('failed', 'rejected')
              and tool.created_at >= now() - (${days} * interval '1 day')
          ) as "failedToolCalls"
        from ai_runs as run
        where run.tenant_id = ${context.tenantId}
          and run.created_at >= now() - (${days} * interval '1 day')
      `;
      const daily = await transaction<
        { date: string; orders: number; handoffs: number; aiRuns: number }[]
      >`
        with tenant_clock as (
          select
            timezone,
            (now() at time zone timezone)::date as local_today
          from tenants
          where id = ${context.tenantId}
        ),
        days as (
          select generated_day::date as day
          from tenant_clock,
          generate_series(
            local_today - (${days - 1} * interval '1 day'),
            local_today,
            interval '1 day'
          ) as generated_day
        )
        select
          to_char(days.day, 'YYYY-MM-DD') as date,
          (
            select count(*)::int
            from orders
            where tenant_id = ${context.tenantId}
              and (created_at at time zone tenant_clock.timezone)::date = days.day
          ) as orders,
          (
            select count(*)::int
            from handoffs
            where tenant_id = ${context.tenantId}
              and (requested_at at time zone tenant_clock.timezone)::date = days.day
          ) as handoffs,
          (
            select count(*)::int
            from ai_runs
            where tenant_id = ${context.tenantId}
              and (created_at at time zone tenant_clock.timezone)::date = days.day
          ) as "aiRuns"
        from days
        cross join tenant_clock
        order by days.day
      `;
      const alerts = await this.loadAlerts(transaction, context.tenantId, days, 10);
      const runCount = ai?.runCount ?? 0;
      const handoffCount = ai?.handoffCount ?? 0;

      return {
        range: query.range,
        generatedAt: new Date().toISOString(),
        timezone: tenant.timezone,
        orders: {
          total: orderTotals?.total ?? 0,
          active: orderTotals?.active ?? 0,
          delivered: orderTotals?.delivered ?? 0,
          cancelled: orderTotals?.cancelled ?? 0,
          byStatus: orderStatusRows,
        },
        salesByCurrency,
        stock: stock ?? { alertCount: 0, outOfStockCount: 0 },
        handoffs: handoffs ?? {
          pending: 0,
          active: 0,
          resolved: 0,
          averageFirstResponseSeconds: null,
          averageResolutionSeconds: null,
        },
        ai: {
          runCount,
          handoffCount,
          handoffRate: runCount === 0 ? 0 : Number((handoffCount / runCount).toFixed(4)),
          averageLatencyMs: Math.round(ai?.averageLatencyMs ?? 0),
          p95LatencyMs: Math.round(ai?.p95LatencyMs ?? 0),
          estimatedCostUsd: ai?.estimatedCostUsd ?? '0',
          failedToolCalls: ai?.failedToolCalls ?? 0,
        },
        daily,
        alerts,
      };
    });
  }

  async listAlerts(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    query: AlertQuery,
  ): Promise<readonly OperationsAlert[]> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'audit:read');
      return this.loadAlerts(transaction, context.tenantId, daysByRange[query.range], query.limit);
    });
  }

  async getTrace(
    identity: VerifiedIdentity,
    requestCorrelationId: string,
    candidateTenantId: string,
    traceCorrelationId: string,
  ): Promise<CorrelationTrace> {
    const context = createCandidateTenantContext(identity, candidateTenantId, requestCorrelationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'audit:read');
      const aiRuns = await transaction<
        {
          id: string;
          conversationId: string | null;
          task: string;
          intent: string;
          outcome: string;
          provider: string | null;
          model: string | null;
          latencyMs: number;
          estimatedCostUsd: string;
          createdAt: Date;
        }[]
      >`
        select
          id::text,
          conversation_id::text as "conversationId",
          task::text,
          intent::text,
          outcome::text,
          provider,
          model,
          latency_ms as "latencyMs",
          estimated_cost_usd::text as "estimatedCostUsd",
          created_at as "createdAt"
        from ai_runs
        where tenant_id = ${context.tenantId}
          and correlation_id = ${traceCorrelationId}
        order by created_at, id
        limit 100
      `;
      const toolCalls = await transaction<
        {
          id: string;
          runId: string;
          name: string;
          kind: string;
          status: string;
          latencyMs: number;
          errorCode: string | null;
          createdAt: Date;
        }[]
      >`
        select
          tool.id::text,
          tool.run_id::text as "runId",
          tool.name,
          tool.kind::text,
          tool.status::text,
          tool.latency_ms as "latencyMs",
          tool.error_code as "errorCode",
          tool.created_at as "createdAt"
        from ai_tool_calls as tool
        join ai_runs as run
          on run.tenant_id = tool.tenant_id
          and run.id = tool.run_id
        where tool.tenant_id = ${context.tenantId}
          and run.correlation_id = ${traceCorrelationId}
        order by tool.created_at, tool.id
        limit 250
      `;
      const messages = await transaction<
        {
          id: string;
          conversationId: string;
          direction: string;
          senderType: string;
          createdAt: Date;
        }[]
      >`
        with matching_runs as (
          select id::text
          from ai_runs
          where tenant_id = ${context.tenantId}
            and correlation_id = ${traceCorrelationId}
        ),
        reply_messages as (
          select message.*
          from messages as message
          where message.tenant_id = ${context.tenantId}
            and message.metadata->'agentReply'->>'runId' in (
              select id from matching_runs
            )
        )
        select distinct
          message.id::text,
          message.conversation_id::text as "conversationId",
          message.direction::text,
          message.sender_type::text as "senderType",
          message.created_at as "createdAt"
        from messages as message
        where message.tenant_id = ${context.tenantId}
          and (
            message.id in (select id from reply_messages)
            or exists (
              select 1
              from reply_messages as reply
              where reply.metadata->>'inReplyToMessageId' = message.id::text
            )
          )
        order by "createdAt", id
        limit 250
      `;
      const orders = await transaction<
        {
          id: string;
          number: string;
          status: string;
          total: string;
          currency: string;
          createdAt: Date;
        }[]
      >`
        select
          orders.id::text,
          orders.number,
          orders.status::text,
          orders.total::text,
          orders.currency,
          orders.created_at as "createdAt"
        from orders
        where orders.tenant_id = ${context.tenantId}
          and (
            exists (
              select 1
              from order_commands
              where tenant_id = orders.tenant_id
                and order_id = orders.id
                and correlation_id = ${traceCorrelationId}
            )
            or exists (
              select 1
              from order_transitions
              where tenant_id = orders.tenant_id
                and order_id = orders.id
                and correlation_id = ${traceCorrelationId}
            )
          )
        order by orders.created_at, orders.id
        limit 100
      `;
      const handoffs = await transaction<
        {
          id: string;
          conversationId: string;
          sourceRunId: string;
          reason: string;
          status: string;
          requestedAt: Date;
          resolvedAt: Date | null;
        }[]
      >`
        select
          handoff.id::text,
          handoff.conversation_id::text as "conversationId",
          handoff.source_run_id::text as "sourceRunId",
          handoff.reason::text,
          handoff.status::text,
          handoff.requested_at as "requestedAt",
          handoff.resolved_at as "resolvedAt"
        from handoffs as handoff
        join ai_runs as run
          on run.tenant_id = handoff.tenant_id
          and run.id = handoff.source_run_id
        where handoff.tenant_id = ${context.tenantId}
          and run.correlation_id = ${traceCorrelationId}
        order by handoff.requested_at, handoff.id
        limit 100
      `;
      const auditEvents = await transaction<
        {
          id: string;
          action: string;
          entityType: string;
          entityId: string;
          createdAt: Date;
        }[]
      >`
        select
          id::text,
          action,
          entity_type as "entityType",
          entity_id as "entityId",
          created_at as "createdAt"
        from audit_events
        where tenant_id = ${context.tenantId}
          and correlation_id = ${traceCorrelationId}
        order by created_at, id
        limit 250
      `;
      if (
        aiRuns.length === 0 &&
        toolCalls.length === 0 &&
        messages.length === 0 &&
        orders.length === 0 &&
        handoffs.length === 0 &&
        auditEvents.length === 0
      ) {
        throw new NotFoundException('No trace was found for this correlation ID.');
      }

      const mappedMessages = messages.map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
      const mappedRuns = aiRuns.map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
      const mappedTools = toolCalls.map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
      const mappedOrders = orders.map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
      const mappedHandoffs = handoffs.map((row) => ({
        ...row,
        requestedAt: iso(row.requestedAt),
        resolvedAt: row.resolvedAt ? iso(row.resolvedAt) : null,
      }));
      const mappedAudits = auditEvents.map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
      const timeline: CorrelationTrace['timeline'] = [
        ...mappedMessages.map((row) => ({
          kind: 'message' as const,
          id: row.id,
          label: `${row.direction}:${row.senderType}`,
          occurredAt: row.createdAt,
        })),
        ...mappedRuns.map((row) => ({
          kind: 'ai_run' as const,
          id: row.id,
          label: `${row.intent}:${row.outcome}`,
          occurredAt: row.createdAt,
        })),
        ...mappedTools.map((row) => ({
          kind: 'tool_call' as const,
          id: row.id,
          label: `${row.name}:${row.status}`,
          occurredAt: row.createdAt,
        })),
        ...mappedOrders.map((row) => ({
          kind: 'order' as const,
          id: row.id,
          label: `${row.number}:${row.status}`,
          occurredAt: row.createdAt,
        })),
        ...mappedHandoffs.map((row) => ({
          kind: 'handoff' as const,
          id: row.id,
          label: `${row.reason}:${row.status}`,
          occurredAt: row.requestedAt,
        })),
        ...mappedAudits.map((row) => ({
          kind: 'audit' as const,
          id: row.id,
          label: `${row.action}:${row.entityType}`,
          occurredAt: row.createdAt,
        })),
      ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));

      return {
        correlationId: traceCorrelationId,
        messages: mappedMessages,
        aiRuns: mappedRuns,
        toolCalls: mappedTools,
        orders: mappedOrders,
        handoffs: mappedHandoffs,
        auditEvents: mappedAudits,
        timeline,
      };
    });
  }
}
