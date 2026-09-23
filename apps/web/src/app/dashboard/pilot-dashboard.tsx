'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type DashboardRange = '7d' | '30d' | '90d';
type AlertSeverity = 'warning' | 'critical';

interface DashboardData {
  range: DashboardRange;
  generatedAt: string;
  timezone: string;
  orders: {
    total: number;
    active: number;
    delivered: number;
    cancelled: number;
    byStatus: { status: string; count: number }[];
  };
  salesByCurrency: { currency: string; amount: string; orderCount: number }[];
  stock: { alertCount: number; outOfStockCount: number };
  handoffs: {
    pending: number;
    active: number;
    resolved: number;
    averageFirstResponseSeconds: number | null;
    averageResolutionSeconds: number | null;
  };
  ai: {
    runCount: number;
    handoffCount: number;
    handoffRate: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
    estimatedCostUsd: string;
    failedToolCalls: number;
  };
  daily: { date: string; orders: number; handoffs: number; aiRuns: number }[];
  alerts: {
    id: string;
    kind: string;
    severity: AlertSeverity;
    title: string;
    detail: string;
    entityId: string;
    correlationId: string | null;
    occurredAt: string;
  }[];
}

interface TraceData {
  correlationId: string;
  messages: unknown[];
  aiRuns: unknown[];
  toolCalls: unknown[];
  orders: unknown[];
  handoffs: unknown[];
  auditEvents: unknown[];
  timeline: {
    kind: 'message' | 'ai_run' | 'tool_call' | 'order' | 'handoff' | 'audit';
    id: string;
    label: string;
    occurredAt: string;
  }[];
}

interface ActivityBucket {
  label: string;
  orders: number;
  handoffs: number;
}

const rangeLabels: Record<DashboardRange, string> = {
  '7d': '7 أيام',
  '30d': '30 يومًا',
  '90d': '90 يومًا',
};

const orderStatusLabels: Record<string, string> = {
  new: 'جديد',
  confirmed: 'مؤكد',
  preparing: 'قيد التحضير',
  shipped: 'شُحن',
  delivered: 'مُسلّم',
  cancelled: 'ملغى',
};

const timelineLabels: Record<TraceData['timeline'][number]['kind'], string> = {
  message: 'رسالة',
  ai_run: 'تشغيل AI',
  tool_call: 'استدعاء أداة',
  order: 'طلب',
  handoff: 'تحويل بشري',
  audit: 'تدقيق',
};

function compactActivity(data: DashboardData['daily']): ActivityBucket[] {
  const groupSize = Math.max(1, Math.ceil(data.length / 30));
  const buckets: ActivityBucket[] = [];
  for (let index = 0; index < data.length; index += groupSize) {
    const group = data.slice(index, index + groupSize);
    const first = group[0];
    if (!first) continue;
    buckets.push({
      label: first.date.slice(5),
      orders: group.reduce((total, item) => total + item.orders, 0),
      handoffs: group.reduce((total, item) => total + item.handoffs, 0),
    });
  }
  return buckets;
}

function formatCurrency(amount: string, currency: string): string {
  const value = Number(amount);
  try {
    return new Intl.NumberFormat('ar-DZ', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString('ar-DZ')} ${currency}`;
  }
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds} ث`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)} د`;
  return `${(seconds / 3_600).toFixed(1)} س`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ar-DZ', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function ActivityChart({ data }: { readonly data: DashboardData['daily'] }) {
  const buckets = compactActivity(data);
  const width = 720;
  const height = 220;
  const padding = { top: 20, right: 18, bottom: 38, left: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maximum = Math.max(1, ...buckets.flatMap((item) => [item.orders, item.handoffs]));
  const groupWidth = buckets.length === 0 ? plotWidth : plotWidth / buckets.length;
  const barWidth = Math.max(2, Math.min(10, groupWidth * 0.32));
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 6));
  const totalOrders = buckets.reduce((total, item) => total + item.orders, 0);
  const totalHandoffs = buckets.reduce((total, item) => total + item.handoffs, 0);

  return (
    <figure className="operations-chart">
      <figcaption>
        <div>
          <span className="eyebrow">ACTIVITY</span>
          <h2>الطلبات والتحويلات</h2>
        </div>
        <div className="chart-legend" aria-label="وسيلة الإيضاح">
          <span>
            <i className="orders-key" aria-hidden="true" /> الطلبات
          </span>
          <span>
            <i className="handoffs-key" aria-hidden="true" /> التحويلات
          </span>
        </div>
      </figcaption>
      <p className="sr-only">
        يعرض الرسم {totalOrders} طلبًا و{totalHandoffs} تحويلًا خلال الفترة المحددة.
      </p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`نشاط الفترة: ${totalOrders} طلبًا و${totalHandoffs} تحويلًا`}
      >
        {[0, 0.5, 1].map((ratio) => {
          const y = padding.top + plotHeight - plotHeight * ratio;
          return (
            <g key={ratio}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                className="chart-grid-line"
              />
              <text x={padding.left - 8} y={y + 4} className="chart-axis-label">
                {Math.round(maximum * ratio)}
              </text>
            </g>
          );
        })}
        {buckets.map((item, index) => {
          const center = padding.left + groupWidth * index + groupWidth / 2;
          const orderHeight = (item.orders / maximum) * plotHeight;
          const handoffHeight = (item.handoffs / maximum) * plotHeight;
          return (
            <g key={`${item.label}-${index}`}>
              <title>
                {item.label}: {item.orders} طلب، {item.handoffs} تحويل
              </title>
              <rect
                x={center - barWidth - 1}
                y={padding.top + plotHeight - orderHeight}
                width={barWidth}
                height={orderHeight}
                rx="3"
                className="orders-bar"
              />
              <rect
                x={center + 1}
                y={padding.top + plotHeight - handoffHeight}
                width={barWidth}
                height={handoffHeight}
                rx="3"
                className="handoffs-bar"
              />
              {index % labelEvery === 0 || index === buckets.length - 1 ? (
                <text x={center} y={height - 13} textAnchor="middle" className="chart-axis-label">
                  {item.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>القيم اليومية أو المجمعة المعروضة في الرسم</caption>
        <thead>
          <tr>
            <th>الفترة</th>
            <th>الطلبات</th>
            <th>التحويلات</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((item, index) => (
            <tr key={`${item.label}-row-${index}`}>
              <td>{item.label}</td>
              <td>{item.orders}</td>
              <td>{item.handoffs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function PilotDashboard() {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
  const [tenantInput, setTenantInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [connection, setConnection] = useState<{ tenantId: string; token: string } | null>(null);
  const [range, setRange] = useState<DashboardRange>('30d');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [traceInput, setTraceInput] = useState('');
  const [trace, setTrace] = useState<TraceData | null>(null);
  const [pending, setPending] = useState(false);
  const [tracePending, setTracePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);

  const request = useCallback(
    async <T,>(path: string): Promise<T> => {
      if (!connection) throw new Error('أدخل بيانات الاتصال أولًا.');
      const response = await fetch(`${apiBaseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${connection.token}`,
          'X-Correlation-Id': crypto.randomUUID(),
        },
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;
        const message = Array.isArray(body?.message) ? body.message.join('، ') : body?.message;
        throw new Error(message ?? `تعذّر تنفيذ الطلب (${response.status}).`);
      }
      return (await response.json()) as T;
    },
    [apiBaseUrl, connection],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!connection) return;
    setPending(true);
    setError(null);
    try {
      const result = await request<DashboardData>(
        `/tenants/${connection.tenantId}/operations/dashboard?range=${range}`,
      );
      setDashboard(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر تحميل مؤشرات Pilot.');
    } finally {
      setPending(false);
    }
  }, [connection, range, request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const primarySale = dashboard?.salesByCurrency[0] ?? null;
  const additionalCurrencies = Math.max(0, (dashboard?.salesByCurrency.length ?? 0) - 1);
  const kpis = useMemo(
    () =>
      dashboard
        ? [
            {
              label: 'المبيعات',
              value: primarySale
                ? formatCurrency(primarySale.amount, primarySale.currency)
                : 'لا توجد مبيعات',
              meta:
                additionalCurrencies > 0
                  ? `+ ${additionalCurrencies} عملة أخرى`
                  : `${primarySale?.orderCount ?? 0} طلب محتسب`,
              tone: 'positive',
            },
            {
              label: 'الطلبات',
              value: dashboard.orders.total.toLocaleString('ar-DZ'),
              meta: `${dashboard.orders.active} نشط · ${dashboard.orders.delivered} مُسلّم`,
              tone: 'neutral',
            },
            {
              label: 'تنبيهات المخزون',
              value: dashboard.stock.alertCount.toLocaleString('ar-DZ'),
              meta: `${dashboard.stock.outOfStockCount} نفد`,
              tone: dashboard.stock.alertCount > 0 ? 'attention' : 'positive',
            },
            {
              label: 'بانتظار موظف',
              value: dashboard.handoffs.pending.toLocaleString('ar-DZ'),
              meta: `أول رد ${formatDuration(dashboard.handoffs.averageFirstResponseSeconds)}`,
              tone: dashboard.handoffs.pending > 0 ? 'attention' : 'positive',
            },
            {
              label: 'AI P95',
              value: `${dashboard.ai.p95LatencyMs.toLocaleString('ar-DZ')} ms`,
              meta: `${dashboard.ai.runCount} تشغيل · ${(dashboard.ai.handoffRate * 100).toFixed(0)}% تحويل`,
              tone: 'neutral',
            },
            {
              label: 'تكلفة AI',
              value: formatCurrency(dashboard.ai.estimatedCostUsd, 'USD'),
              meta: `${dashboard.ai.failedToolCalls} أداة فاشلة/مرفوضة`,
              tone: dashboard.ai.failedToolCalls > 0 ? 'risk' : 'neutral',
            },
          ]
        : [],
    [additionalCurrencies, dashboard, primarySale],
  );

  function connect(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    if (!/^[0-9a-f-]{36}$/iu.test(tenantInput.trim()) || tokenInput.trim().length < 10) {
      setError('تحقق من معرّف المتجر ورمز الدخول.');
      return;
    }
    setConnection({ tenantId: tenantInput.trim(), token: tokenInput.trim() });
    setTokenInput('');
  }

  async function findTrace(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!connection || traceInput.trim().length === 0) return;
    setTracePending(true);
    setTraceError(null);
    setTrace(null);
    try {
      const result = await request<TraceData>(
        `/tenants/${connection.tenantId}/operations/traces/${encodeURIComponent(traceInput.trim())}`,
      );
      setTrace(result);
    } catch (caught) {
      setTraceError(caught instanceof Error ? caught.message : 'تعذّر تحميل التتبع.');
    } finally {
      setTracePending(false);
    }
  }

  if (!connection) {
    return (
      <main className="operations-login">
        <form className="connect-card" onSubmit={connect}>
          <span className="eyebrow">PILOT OPERATIONS</span>
          <h1>مركز التشغيل</h1>
          <p>
            أدخل متجر Pilot ورمز دخول Owner أو Manager. يبقى الرمز في ذاكرة الصفحة ولا يُحفظ في
            المتصفح.
          </p>
          <label>
            معرّف المتجر
            <input
              dir="ltr"
              autoComplete="off"
              value={tenantInput}
              onChange={(event) => setTenantInput(event.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </label>
          <label>
            رمز الدخول
            <input
              dir="ltr"
              type="password"
              autoComplete="off"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="Bearer token"
            />
          </label>
          {error ? <p className="error-banner">{error}</p> : null}
          <button type="submit">فتح لوحة Pilot</button>
          <a href="/">العودة إلى الرئيسية</a>
        </form>
      </main>
    );
  }

  return (
    <main className="operations-app">
      <header className="operations-header">
        <div>
          <span className="eyebrow">PILOT CONTROL ROOM</span>
          <h1>حالة المتجر</h1>
          <p>
            {dashboard
              ? `آخر تحديث ${formatDate(dashboard.generatedAt)} · ${dashboard.timezone}`
              : 'تحميل المؤشرات التشغيلية…'}
          </p>
        </div>
        <div className="operations-actions">
          <nav aria-label="روابط التشغيل">
            <a href="/inbox">الصندوق</a>
            <a href="/settings/configuration">الإعدادات</a>
          </nav>
          <label>
            الفترة
            <select
              value={range}
              onChange={(event) => setRange(event.target.value as DashboardRange)}
            >
              {(Object.keys(rangeLabels) as DashboardRange[]).map((value) => (
                <option key={value} value={value}>
                  {rangeLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={pending} onClick={() => void refresh()}>
            {pending ? 'جارٍ التحديث…' : 'تحديث'}
          </button>
        </div>
      </header>

      {error ? <p className="error-banner">{error}</p> : null}

      {dashboard ? (
        <>
          <section className="kpi-grid" aria-label="مؤشرات Pilot">
            {kpis.map((kpi) => (
              <article className={`kpi-card ${kpi.tone}`} key={kpi.label}>
                <span>{kpi.label}</span>
                <strong>{kpi.value}</strong>
                <small>{kpi.meta}</small>
              </article>
            ))}
          </section>

          <section className="operations-main-grid">
            <ActivityChart data={dashboard.daily} />
            <section className="operations-panel status-panel">
              <header>
                <div>
                  <span className="eyebrow">ORDERS</span>
                  <h2>حالات الطلبات</h2>
                </div>
              </header>
              <div className="order-status-list">
                {dashboard.orders.byStatus.length > 0 ? (
                  dashboard.orders.byStatus.map((item) => (
                    <div key={item.status}>
                      <span>{orderStatusLabels[item.status] ?? item.status}</span>
                      <b>{item.count.toLocaleString('ar-DZ')}</b>
                    </div>
                  ))
                ) : (
                  <p className="operations-empty">لا توجد طلبات في هذه الفترة.</p>
                )}
              </div>
              <dl className="ai-summary">
                <div>
                  <dt>متوسط AI</dt>
                  <dd>{dashboard.ai.averageLatencyMs.toLocaleString('ar-DZ')} ms</dd>
                </div>
                <div>
                  <dt>التحويلات النشطة</dt>
                  <dd>{dashboard.handoffs.active.toLocaleString('ar-DZ')}</dd>
                </div>
                <div>
                  <dt>متوسط الحل</dt>
                  <dd>{formatDuration(dashboard.handoffs.averageResolutionSeconds)}</dd>
                </div>
              </dl>
            </section>
          </section>

          <section className="operations-bottom-grid">
            <section className="operations-panel alerts-panel">
              <header>
                <div>
                  <span className="eyebrow">ALERTS</span>
                  <h2>تحتاج انتباهًا</h2>
                </div>
                <b>{dashboard.alerts.length}</b>
              </header>
              <div className="alerts-list">
                {dashboard.alerts.length > 0 ? (
                  dashboard.alerts.map((alert) => (
                    <article className={`operations-alert ${alert.severity}`} key={alert.id}>
                      <span aria-hidden="true" />
                      <div>
                        <h3>{alert.title}</h3>
                        <p>{alert.detail}</p>
                        <time>{formatDate(alert.occurredAt)}</time>
                      </div>
                      {alert.correlationId ? (
                        <button
                          type="button"
                          onClick={() => setTraceInput(alert.correlationId ?? '')}
                        >
                          تتبع
                        </button>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <p className="operations-empty">لا توجد تنبيهات مفتوحة ضمن الحدود الحالية.</p>
                )}
              </div>
            </section>

            <section className="operations-panel trace-panel">
              <header>
                <div>
                  <span className="eyebrow">TRACE</span>
                  <h2>تتبع Correlation ID</h2>
                </div>
              </header>
              <form onSubmit={(event) => void findTrace(event)}>
                <label htmlFor="trace-correlation">معرّف التتبع</label>
                <div>
                  <input
                    id="trace-correlation"
                    dir="ltr"
                    value={traceInput}
                    onChange={(event) => setTraceInput(event.target.value)}
                    placeholder="request-123"
                  />
                  <button type="submit" disabled={tracePending || traceInput.trim().length === 0}>
                    {tracePending ? 'بحث…' : 'بحث'}
                  </button>
                </div>
              </form>
              {traceError ? <p className="trace-error">{traceError}</p> : null}
              {trace ? (
                <>
                  <div className="trace-counts">
                    <span>{trace.messages.length} رسالة</span>
                    <span>{trace.toolCalls.length} أداة</span>
                    <span>{trace.orders.length} طلب</span>
                  </div>
                  <ol className="trace-timeline">
                    {trace.timeline.map((event, index) => (
                      <li key={`${event.kind}-${event.id}-${index}`}>
                        <span>{timelineLabels[event.kind]}</span>
                        <b dir="ltr">{event.label}</b>
                        <time>{formatDate(event.occurredAt)}</time>
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className="operations-empty">
                  أدخل المعرّف لربط الرسالة وAI Tool والطلب في خط زمني واحد.
                </p>
              )}
            </section>
          </section>
        </>
      ) : pending ? (
        <p className="operations-empty">جارٍ تحميل لوحة Pilot…</p>
      ) : null}
    </main>
  );
}
