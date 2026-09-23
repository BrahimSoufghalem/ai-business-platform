'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type ConversationStatus = 'bot' | 'needs_human' | 'human' | 'closed';
type HandoffReason =
  | 'explicit_customer_request'
  | 'low_confidence'
  | 'safety_risk'
  | 'tool_failure'
  | 'pricing_policy'
  | 'order_exception'
  | 'unsupported_request'
  | 'manual';

interface Handoff {
  id: string;
  reason: HandoffReason;
  status: 'pending' | 'active' | 'resolved';
  summary: {
    intent: string;
    customerRequest: string;
    product: { id: string; name: string } | null;
    collectedData: {
      draftOrderId: string | null;
      draftStatus: string | null;
      hasCustomerPhone: boolean;
      hasShippingAddress: boolean;
      itemCount: number;
      orderId: string | null;
      orderNumber: string | null;
    };
  };
  currentWaitSeconds: number;
  firstResponseSeconds: number | null;
  resolutionSeconds: number | null;
}

interface HandoffMetrics {
  pending: number;
  active: number;
  resolved: number;
  averageFirstResponseSeconds: number | null;
  averageResolutionSeconds: number | null;
}

interface ConversationSummary {
  id: string;
  customer: { id: string; name: string; contactHint: string | null };
  channel: string;
  status: ConversationStatus;
  assignedToUserId: string | null;
  assignedToMe: boolean;
  activeHandoff: Handoff | null;
  subject: string | null;
  version: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
}

interface Message {
  id: string;
  direction: 'inbound' | 'outbound' | 'internal';
  senderType: 'customer' | 'agent' | 'bot' | 'system';
  content: string;
  createdAt: string;
}

interface Conversation extends ConversationSummary {
  productId: string | null;
  draftOrderId: string | null;
  orderId: string | null;
  messages: Message[];
  handoffs: Handoff[];
}

const statusLabels: Record<ConversationStatus, string> = {
  bot: 'مع البوت',
  needs_human: 'تحتاج موظفًا',
  human: 'مع موظف',
  closed: 'مغلقة',
};

const channelLabels: Record<string, string> = {
  internal: 'داخلي',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  web: 'الويب',
  email: 'البريد',
};

const handoffReasonLabels: Record<HandoffReason, string> = {
  explicit_customer_request: 'طلب العميل موظفًا',
  low_confidence: 'ثقة غير كافية',
  safety_risk: 'مخاطر أمان',
  tool_failure: 'تعذر أداة النظام',
  pricing_policy: 'استثناء في سياسة السعر',
  order_exception: 'استثناء في الطلب',
  unsupported_request: 'طلب غير مدعوم آليًا',
  manual: 'تحويل يدوي',
};

function formatTime(value: string | null): string {
  if (!value) return 'بلا رسائل';
  return new Intl.DateTimeFormat('ar-DZ', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
  }).format(new Date(value));
}

function formatDuration(value: number | null): string {
  if (value === null) return '—';
  if (value < 60) return `${value}ث`;
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes}د`;
  return `${Math.round(minutes / 60)}س`;
}

export function InboxClient() {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
  const [tenantInput, setTenantInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [connection, setConnection] = useState<{ tenantId: string; token: string } | null>(null);
  const [status, setStatus] = useState<ConversationStatus | 'all'>('all');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [handoffMetrics, setHandoffMetrics] = useState<HandoffMetrics>({
    pending: 0,
    active: 0,
    resolved: 0,
    averageFirstResponseSeconds: null,
    averageResolutionSeconds: null,
  });
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [reply, setReply] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (!connection) throw new Error('أدخل بيانات الاتصال أولًا.');
      const response = await fetch(`${apiBaseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${connection.token}`,
          'Content-Type': 'application/json',
          'X-Correlation-Id': crypto.randomUUID(),
          ...init?.headers,
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

  const loadConversation = useCallback(
    async (id: string): Promise<void> => {
      if (!connection) return;
      const result = await request<Conversation>(
        `/tenants/${connection.tenantId}/conversations/${id}`,
      );
      setSelected(result);
    },
    [connection, request],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!connection) return;
    setPending(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: '100' });
      if (status !== 'all') query.set('status', status);
      const [result, metrics] = await Promise.all([
        request<ConversationSummary[]>(
          `/tenants/${connection.tenantId}/conversations?${query.toString()}`,
        ),
        request<HandoffMetrics>(`/tenants/${connection.tenantId}/conversations/handoff-metrics`),
      ]);
      setConversations(result);
      setHandoffMetrics(metrics);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر تحميل الصندوق.');
    } finally {
      setPending(false);
    }
  }, [connection, request, status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const counters = useMemo(
    () => ({
      urgent: handoffMetrics.pending,
      mine: conversations.filter((item) => item.assignedToMe).length,
    }),
    [conversations, handoffMetrics.pending],
  );

  function connect(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    if (!/^[0-9a-f-]{36}$/i.test(tenantInput.trim()) || tokenInput.trim().length < 10) {
      setError('تحقق من معرّف المتجر ورمز الدخول.');
      return;
    }
    setConnection({ tenantId: tenantInput.trim(), token: tokenInput.trim() });
    setTokenInput('');
    setSelected(null);
  }

  async function mutate(path: string, body: Readonly<Record<string, unknown>>): Promise<void> {
    if (!connection || !selected) return;
    setPending(true);
    setError(null);
    try {
      const result = await request<Conversation>(
        `/tenants/${connection.tenantId}/conversations/${selected.id}${path}`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      setSelected(result);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر تحديث المحادثة.');
    } finally {
      setPending(false);
    }
  }

  async function sendReply(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!connection || !selected || reply.trim().length === 0) return;
    setPending(true);
    setError(null);
    try {
      await request(`/tenants/${connection.tenantId}/conversations/${selected.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          direction: 'outbound',
          senderType: 'agent',
          content: reply.trim(),
        }),
      });
      setReply('');
      await loadConversation(selected.id);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر إرسال الرد.');
    } finally {
      setPending(false);
    }
  }

  if (!connection) {
    return (
      <main className="inbox-login">
        <form className="connect-card" onSubmit={connect}>
          <span className="eyebrow">INTERNAL INBOX</span>
          <h1>صندوق المحادثات</h1>
          <p>
            أدخل متجر الاختبار ورمز دخول صالحًا. يبقى الرمز في ذاكرة هذه الصفحة ولا يُحفظ في
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
          <button type="submit">فتح الصندوق</button>
          <a href="/">العودة إلى الرئيسية</a>
        </form>
      </main>
    );
  }

  return (
    <main className="inbox-app">
      <header className="inbox-header">
        <div>
          <span className="eyebrow">TEAM INBOX</span>
          <h1>المحادثات</h1>
        </div>
        <div className="inbox-metrics">
          <span>
            <b>{counters.urgent}</b> تحتاج تدخلًا
          </span>
          <span>
            <b>{counters.mine}</b> لديّ
          </span>
          <span>
            أول رد <b>{formatDuration(handoffMetrics.averageFirstResponseSeconds)}</b>
          </span>
          <span>
            الحل <b>{formatDuration(handoffMetrics.averageResolutionSeconds)}</b>
          </span>
          <button className="ghost-button" type="button" onClick={() => void refresh()}>
            تحديث
          </button>
        </div>
      </header>

      {error ? <p className="error-banner">{error}</p> : null}

      <section className="inbox-layout">
        <aside className="conversation-list">
          <nav className="status-tabs" aria-label="تصفية المحادثات">
            {(['all', 'needs_human', 'human', 'bot', 'closed'] as const).map((value) => (
              <button
                type="button"
                className={status === value ? 'active' : ''}
                key={value}
                onClick={() => setStatus(value)}
              >
                {value === 'all' ? 'الكل' : statusLabels[value]}
              </button>
            ))}
          </nav>
          <div className="conversation-scroll">
            {conversations.map((conversation) => (
              <button
                className={`conversation-row ${selected?.id === conversation.id ? 'selected' : ''}`}
                type="button"
                key={conversation.id}
                onClick={() => void loadConversation(conversation.id)}
              >
                <span className="avatar">{conversation.customer.name.slice(0, 1)}</span>
                <span className="row-copy">
                  <span className="row-title">
                    <b>{conversation.customer.name}</b>
                    <time>{formatTime(conversation.lastMessageAt)}</time>
                  </span>
                  <span className="contact-hint">
                    {conversation.customer.contactHint ?? 'بيانات الاتصال محجوبة'}
                  </span>
                  <span className="preview">
                    {conversation.lastMessagePreview ?? 'لم تبدأ الرسائل بعد'}
                  </span>
                </span>
                <span className={`status-pill ${conversation.status}`}>
                  {statusLabels[conversation.status]}
                </span>
              </button>
            ))}
            {!pending && conversations.length === 0 ? (
              <p className="empty-state">لا توجد محادثات ضمن هذا الفلتر.</p>
            ) : null}
          </div>
        </aside>

        <section className="thread-panel">
          {selected ? (
            <>
              <header className="thread-header">
                <div>
                  <h2>{selected.customer.name}</h2>
                  <p>
                    {channelLabels[selected.channel] ?? selected.channel} ·{' '}
                    {selected.customer.contactHint ?? 'بيانات الاتصال محجوبة'}
                  </p>
                </div>
                <div className="thread-actions">
                  {selected.status === 'needs_human' ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void mutate('/claim', { expectedVersion: selected.version })}
                    >
                      استلام
                    </button>
                  ) : null}
                  {selected.assignedToMe && selected.status === 'human' ? (
                    <button
                      className="ghost-button"
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        void mutate('/release', {
                          expectedVersion: selected.version,
                          reason: 'Released from internal inbox',
                        })
                      }
                    >
                      تحرير
                    </button>
                  ) : null}
                  {(selected.assignedToMe && selected.status === 'human') ||
                  selected.status === 'needs_human' ? (
                    <button
                      className="ghost-button"
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        void mutate('/status', {
                          expectedVersion: selected.version,
                          targetStatus: 'bot',
                          reason: 'Returned to bot after human review',
                        })
                      }
                    >
                      إعادة للبوت
                    </button>
                  ) : null}
                  {selected.status !== 'closed' ? (
                    <button
                      className="ghost-button"
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        void mutate('/status', {
                          expectedVersion: selected.version,
                          targetStatus: 'closed',
                          reason: 'Closed from internal inbox',
                        })
                      }
                    >
                      إغلاق
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        void mutate('/status', {
                          expectedVersion: selected.version,
                          targetStatus: 'needs_human',
                          reason: 'Reopened from internal inbox',
                        })
                      }
                    >
                      إعادة فتح
                    </button>
                  )}
                </div>
              </header>

              <div className="linked-records">
                <span>{selected.subject ?? 'بلا عنوان'}</span>
                {selected.productId ? <span>منتج مرتبط</span> : null}
                {selected.draftOrderId ? <span>مسودة مرتبطة</span> : null}
                {selected.orderId ? <span>طلب مرتبط</span> : null}
              </div>

              {selected.activeHandoff ? (
                <section className="handoff-card" aria-label="ملخص التحويل">
                  <div>
                    <span className="eyebrow">HUMAN HANDOFF</span>
                    <h3>{handoffReasonLabels[selected.activeHandoff.reason]}</h3>
                    <p>{selected.activeHandoff.summary.customerRequest}</p>
                  </div>
                  <dl>
                    <div>
                      <dt>النية</dt>
                      <dd>{selected.activeHandoff.summary.intent}</dd>
                    </div>
                    <div>
                      <dt>المنتج</dt>
                      <dd>{selected.activeHandoff.summary.product?.name ?? 'غير محدد'}</dd>
                    </div>
                    <div>
                      <dt>المجموعة</dt>
                      <dd>
                        {selected.activeHandoff.summary.collectedData.itemCount} عنصر · هاتف{' '}
                        {selected.activeHandoff.summary.collectedData.hasCustomerPhone ? '✓' : '—'}{' '}
                        · عنوان{' '}
                        {selected.activeHandoff.summary.collectedData.hasShippingAddress
                          ? '✓'
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>الانتظار</dt>
                      <dd>{formatDuration(selected.activeHandoff.currentWaitSeconds)}</dd>
                    </div>
                  </dl>
                </section>
              ) : null}

              <div className="messages" aria-live="polite">
                {selected.messages.map((message) => (
                  <article
                    className={`message ${
                      message.direction === 'inbound'
                        ? 'incoming'
                        : message.direction === 'internal'
                          ? 'internal'
                          : 'outgoing'
                    }`}
                    key={message.id}
                  >
                    <p>{message.content}</p>
                    <time>{formatTime(message.createdAt)}</time>
                  </article>
                ))}
                {selected.messages.length === 0 ? (
                  <p className="empty-state">هذه المحادثة بلا رسائل حتى الآن.</p>
                ) : null}
              </div>

              <form className="reply-box" onSubmit={(event) => void sendReply(event)}>
                <textarea
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder="اكتب ردًا للعميل…"
                  maxLength={20_000}
                  disabled={pending || selected.status !== 'human' || !selected.assignedToMe}
                />
                <button
                  type="submit"
                  disabled={
                    pending ||
                    selected.status !== 'human' ||
                    !selected.assignedToMe ||
                    reply.trim().length === 0
                  }
                >
                  إرسال
                </button>
              </form>
            </>
          ) : (
            <div className="thread-placeholder">
              <span>↗</span>
              <h2>اختر محادثة</h2>
              <p>راجع السياق ثم استلم المحادثة أو أغلقها من مكان واحد.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
