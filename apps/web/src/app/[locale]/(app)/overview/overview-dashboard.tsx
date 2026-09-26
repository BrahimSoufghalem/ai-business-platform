'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useApi, useTenantPath } from '../../../../components/providers';
import { useAsyncData } from '../../../../lib/use-async-data';
import { useQueryState } from '../../../../lib/use-query-state';
import { formatMoney, formatNumber, formatRelativeTime } from '../../../../lib/format';
import { ApiError } from '../../../../lib/api/client';
import type {
  InstagramConnectionView,
  OperationsAlert,
  OperationsDashboard,
} from '../../../../lib/api/types';
import { Link } from '../../../../i18n/navigation';
import { PageHeader } from '../../../../components/ui/page-header';
import { Select } from '../../../../components/ui/select';
import { Badge } from '../../../../components/ui/badge';
import { Skeleton } from '../../../../components/ui/skeleton';
import { ErrorState } from '../../../../components/ui/error-state';
import { InlineAlert } from '../../../../components/ui/alert';
import { Icon } from '../../../../components/icons';

export function OverviewDashboard() {
  const t = useTranslations('overview');
  const locale = useLocale();
  const api = useApi();
  const tenant = useTenantPath();
  const { searchParams, setParams } = useQueryState();
  const range = searchParams.get('range') ?? '7d';

  const dashboardQuery = useAsyncData<OperationsDashboard | 'forbidden'>(
    async (signal) => {
      try {
        return await api.get<OperationsDashboard>(
          tenant(`/operations/dashboard?range=${encodeURIComponent(range)}`),
          { signal },
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) return 'forbidden';
        throw error;
      }
    },
    [api, tenant, range],
  );

  const instagramQuery = useAsyncData<InstagramConnectionView | null>(
    async (signal) => {
      try {
        return await api.get<InstagramConnectionView>(tenant('/integrations/instagram'), {
          signal,
        });
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 403))
          return null;
        return null;
      }
    },
    [api, tenant],
  );

  const dashboard = dashboardQuery.data === 'forbidden' ? null : dashboardQuery.data;
  const forbidden = dashboardQuery.data === 'forbidden';

  const salesLabel = useMemo(() => {
    if (!dashboard || dashboard.salesByCurrency.length === 0) return '—';
    return dashboard.salesByCurrency
      .map((entry) => formatMoney(entry.amount, entry.currency, locale))
      .join(' + ');
  }, [dashboard, locale]);

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Select
            aria-label={t('range7')}
            value={range}
            onChange={(e) => setParams({ range: e.target.value })}
          >
            <option value="today">{t('rangeToday')}</option>
            <option value="7d">{t('range7')}</option>
            <option value="30d">{t('range30')}</option>
          </Select>
        }
      />

      {forbidden ? (
        <InlineAlert kind="info">{t('forbiddenBody')}</InlineAlert>
      ) : dashboardQuery.loading ? (
        <div className="stack">
          <div className="kpi-strip">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="kpi">
                <Skeleton height={13} width="55%" />
                <Skeleton height={26} width="40%" />
              </div>
            ))}
          </div>
          <Skeleton lines={5} height={18} />
        </div>
      ) : dashboardQuery.error ? (
        <ErrorState onRetry={dashboardQuery.reload} />
      ) : dashboard ? (
        <>
          <div className="kpi-strip">
            <div className="kpi">
              <p className="kpi__label">{t('todaySales')}</p>
              <p className="kpi__value">{salesLabel}</p>
            </div>
            <div className="kpi">
              <p className="kpi__label">{t('ordersCount')}</p>
              <p className="kpi__value">{formatNumber(dashboard.orders.total, locale)}</p>
              <p className="kpi__hint">
                {t('delivered')}: {formatNumber(dashboard.orders.delivered, locale)} ·{' '}
                {t('cancelled')}: {formatNumber(dashboard.orders.cancelled, locale)}
              </p>
            </div>
            <div className={`kpi${dashboard.orders.active > 0 ? ' kpi--alert' : ''}`}>
              <p className="kpi__label">{t('ordersNeedAttention')}</p>
              <p className="kpi__value">{formatNumber(dashboard.orders.active, locale)}</p>
            </div>
            <div className={`kpi${dashboard.stock.alertCount > 0 ? ' kpi--critical' : ''}`}>
              <p className="kpi__label">{t('lowStock')}</p>
              <p className="kpi__value">{formatNumber(dashboard.stock.alertCount, locale)}</p>
              <p className="kpi__hint">
                {t('outOfStockLabel', {
                  count: formatNumber(dashboard.stock.outOfStockCount, locale),
                })}
              </p>
            </div>
            <div className={`kpi${dashboard.handoffs.pending > 0 ? ' kpi--critical' : ''}`}>
              <p className="kpi__label">{t('openConversations')}</p>
              <p className="kpi__value">{formatNumber(dashboard.handoffs.pending, locale)}</p>
            </div>
            <div className="kpi">
              <p className="kpi__label" translate="no">
                {t('instagramStatus')}
              </p>
              <p className="kpi__value" style={{ fontSize: 'var(--text-h3)' }}>
                {instagramQuery.data && instagramQuery.data.status === 'active' ? (
                  <Badge tone="success">{t('connected')}</Badge>
                ) : (
                  <Badge tone="neutral">{t('notConnected')}</Badge>
                )}
              </p>
            </div>
          </div>

          <div className="grid-2" style={{ alignItems: 'start' }}>
            <section className="panel" id="alerts">
              <div className="panel__header">
                <h2 className="panel__title">{t('alertsTitle')}</h2>
              </div>
              {dashboard.alerts.length === 0 ? (
                <div className="panel__body">
                  <p className="meta-text">{t('noAlerts')}</p>
                </div>
              ) : (
                <ul className="alert-list" role="list">
                  {dashboard.alerts.map((alert) => (
                    <AlertRow key={alert.id} alert={alert} />
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <div className="panel__header">
                <h2 className="panel__title">{t('activityTitle')}</h2>
              </div>
              <div className="panel__body">
                {dashboard.daily.length < 2 ? (
                  <p className="meta-text">{t('activityEmpty')}</p>
                ) : (
                  <DailyTrend
                    daily={dashboard.daily}
                    totalLabel={(total) => t('trendTotal', { count: formatNumber(total, locale) })}
                  />
                )}
                <dl className="detail-list mt-4">
                  <dt>{t('aiRuns')}</dt>
                  <dd className="num">{formatNumber(dashboard.ai.runCount, locale)}</dd>
                  <dt>{t('handoffRate')}</dt>
                  <dd className="num">
                    {formatNumber(Math.round(dashboard.ai.handoffRate * 100), locale)}%
                  </dd>
                </dl>
              </div>
            </section>
          </div>

          <section className="panel mt-4">
            <div className="panel__header">
              <h2 className="panel__title">{t('quickActions')}</h2>
            </div>
            <div className="panel__body" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link href="/products/new" className="btn btn--secondary btn--sm">
                <Icon name="plus" size={15} /> {t('addProduct')}
              </Link>
              <Link href="/inbox?status=needs_human" className="btn btn--secondary btn--sm">
                <Icon name="inbox" size={15} /> {t('openInbox')}
              </Link>
              <Link href="/orders" className="btn btn--secondary btn--sm">
                <Icon name="shopping-bag" size={15} /> {t('viewOrders')}
              </Link>
              <Link href="/inventory?low=1" className="btn btn--secondary btn--sm">
                <Icon name="box" size={15} /> {t('viewInventory')}
              </Link>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}

function AlertRow({ alert }: { alert: OperationsAlert }) {
  const locale = useLocale();
  const t = useTranslations('overview');
  const data = alert.data ?? {};
  const title =
    alert.kind === 'low_stock'
      ? Number(data.available) === 0
        ? t('alertOutOfStockTitle')
        : t('alertLowStockTitle')
      : alert.kind === 'handoff_wait'
        ? t('alertHandoffTitle')
        : alert.kind === 'ai_tool_failure'
          ? data.status === 'rejected'
            ? t('alertToolRejectedTitle')
            : t('alertToolFailedTitle')
          : alert.title;
  const detail =
    alert.kind === 'low_stock' && typeof data.productName === 'string'
      ? t('alertLowStockDetail', {
          product: data.productName,
          variant:
            typeof data.variantName === 'string'
              ? data.variantName
              : typeof data.sku === 'string'
                ? data.sku
                : '—',
          location: typeof data.locationName === 'string' ? data.locationName : '—',
          available: formatNumber(Number(data.available ?? 0), locale),
          reorderPoint: formatNumber(Number(data.reorderPoint ?? 0), locale),
        })
      : alert.kind === 'handoff_wait' && typeof data.waitMinutes === 'number'
        ? t('alertHandoffDetail', { minutes: formatNumber(data.waitMinutes, locale) })
        : alert.kind === 'ai_tool_failure' && typeof data.name === 'string'
          ? t('alertToolDetail', {
              name: data.name,
              code: typeof data.errorCode === 'string' ? data.errorCode : '—',
            })
          : alert.detail;
  const icon =
    alert.severity === 'critical'
      ? 'alert-circle'
      : alert.severity === 'warning'
        ? 'alert-triangle'
        : 'info';
  return (
    <li className="alert-row">
      <span
        style={{
          color:
            alert.severity === 'critical'
              ? 'var(--danger)'
              : alert.severity === 'warning'
                ? 'var(--warning)'
                : 'var(--info)',
          marginTop: 2,
        }}
      >
        <Icon name={icon} size={18} />
      </span>
      <div className="alert-row__body">
        <p className="alert-row__title" dir="auto">
          {title}
        </p>
        <p className="alert-row__detail" dir="auto">
          {detail}
        </p>
      </div>
      <span className="alert-row__time">{formatRelativeTime(alert.occurredAt, locale)}</span>
    </li>
  );
}

/** Compact inline SVG trend built from real daily order counts — no chart library. */
function DailyTrend({
  daily,
  totalLabel,
}: {
  daily: OperationsDashboard['daily'];
  totalLabel: (total: number) => string;
}) {
  const points = daily.slice(-14);
  const max = Math.max(...points.map((point) => point.orders), 1);
  const width = 560;
  const height = 120;
  const stepX = points.length > 1 ? width / (points.length - 1) : width;
  const pathData = points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${(index * stepX).toFixed(1)},${(height - 12 - (point.orders / max) * (height - 32)).toFixed(1)}`,
    )
    .join(' ');

  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="orders trend"
        style={{ width: '100%', height: 'auto' }}
      >
        <path
          d={pathData}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((point, index) => (
          <circle
            key={point.date}
            cx={index * stepX}
            cy={height - 12 - (point.orders / max) * (height - 32)}
            r={3}
            fill="var(--accent)"
          />
        ))}
      </svg>
      <figcaption
        className="meta-text"
        style={{ display: 'flex', justifyContent: 'space-between' }}
      >
        <span>{totalLabel(points.reduce((sum, p) => sum + p.orders, 0))}</span>
        <span className="num" translate="no">
          {points[0]?.date} — {points[points.length - 1]?.date}
        </span>
      </figcaption>
    </figure>
  );
}
