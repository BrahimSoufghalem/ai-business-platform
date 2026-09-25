'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useApi, useTenantPath } from '../../../../components/providers';
import { useQueryState } from '../../../../lib/use-query-state';
import { formatDurationSeconds, formatRelativeTime } from '../../../../lib/format';
import type {
  Conversation,
  ConversationSummary,
  HandoffMetrics,
  HandoffReason,
  Message,
} from '../../../../lib/api/types';
import { PageHeader } from '../../../../components/ui/page-header';
import { SearchInput } from '../../../../components/ui/search-input';
import { Select } from '../../../../components/ui/select';
import { Badge, type BadgeTone } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Textarea } from '../../../../components/ui/textarea';
import { Checkbox } from '../../../../components/ui/checkbox';
import { EmptyState } from '../../../../components/ui/empty-state';
import { ErrorState } from '../../../../components/ui/error-state';
import { Skeleton } from '../../../../components/ui/skeleton';
import { InlineAlert } from '../../../../components/ui/alert';
import { Icon } from '../../../../components/icons';
import { useToast } from '../../../../components/ui/toast';
import { Link } from '../../../../i18n/navigation';

const statusTone: Record<string, BadgeTone> = {
  bot: 'accent',
  needs_human: 'danger',
  human: 'warning',
  closed: 'neutral',
};

const statusKey: Record<string, string> = {
  bot: 'statusBot',
  needs_human: 'statusNeedsHuman',
  human: 'statusHuman',
  closed: 'statusClosed',
};

const channelKey: Record<string, string> = {
  internal: 'channelInternal',
  instagram: 'channelInstagram',
  whatsapp: 'channelWhatsapp',
  web: 'channelWeb',
  email: 'channelEmail',
};

const reasonKey: Record<HandoffReason, string> = {
  explicit_customer_request: 'reasonExplicit',
  low_confidence: 'reasonLowConfidence',
  safety_risk: 'reasonSafety',
  tool_failure: 'reasonToolFailure',
  pricing_policy: 'reasonPricing',
  order_exception: 'reasonOrder',
  unsupported_request: 'reasonUnsupported',
  manual: 'reasonManual',
};

export function InboxStudio() {
  const t = useTranslations('inbox');
  const tc = useTranslations('common');
  const locale = useLocale();
  const api = useApi();
  const tenant = useTenantPath();
  const { searchParams, setParams } = useQueryState();

  const status = searchParams.get('status') ?? '';
  const channel = searchParams.get('channel') ?? '';
  const assignment = searchParams.get('assignment') ?? '';
  const q = searchParams.get('q') ?? '';
  const selectedId = searchParams.get('c') ?? '';
  const [searchInput, setSearchInput] = useState(q);

  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [metrics, setMetrics] = useState<HandoffMetrics | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const listQuery = useMemo(() => {
    const params = new URLSearchParams({ limit: '100' });
    if (status) params.set('status', status);
    if (channel) params.set('channel', channel);
    if (assignment) params.set('assignment', assignment);
    if (q) params.set('q', q);
    return params.toString();
  }, [status, channel, assignment, q]);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const [items, handoffMetrics] = await Promise.all([
        api.get<ConversationSummary[]>(tenant(`/conversations?${listQuery}`)),
        api.get<HandoffMetrics>(tenant('/conversations/handoff-metrics')),
      ]);
      setConversations(items);
      setMetrics(handoffMetrics);
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'error');
    } finally {
      setListLoading(false);
    }
  }, [api, tenant, listQuery]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadConversation = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const conversation = await api.get<Conversation>(tenant(`/conversations/${id}`));
        setSelected(conversation);
      } catch (error) {
        setDetailError(error instanceof Error ? error.message : 'error');
      } finally {
        setDetailLoading(false);
      }
    },
    [api, tenant],
  );

  useEffect(() => {
    if (selectedId) void loadConversation(selectedId);
    else setSelected(null);
  }, [selectedId, loadConversation]);

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        count={conversations?.length}
        actions={
          <Button
            variant="secondary"
            onClick={() => void loadList()}
            icon={<Icon name="refresh" size={16} />}
          >
            {t('refresh')}
          </Button>
        }
      />

      {metrics && (metrics.pending > 0 || metrics.active > 0) ? (
        <div className="filter-bar" aria-label={t('pendingHandoffs')}>
          <Badge tone="danger">
            {t('pendingHandoffs')}: {metrics.pending}
          </Badge>
          <Badge tone="warning">
            {t('activeHandoffs')}: {metrics.active}
          </Badge>
        </div>
      ) : null}

      <div className="filter-bar" role="search">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParams({ q: searchInput || null });
          }}
          style={{ display: 'contents' }}
        >
          <SearchInput
            placeholder={t('searchPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label={t('searchPlaceholder')}
          />
        </form>
        <Select
          aria-label={t('statusFilter')}
          value={status}
          onChange={(e) => setParams({ status: e.target.value || null })}
        >
          <option value="">{tc('all')}</option>
          {Object.keys(statusKey).map((value) => (
            <option key={value} value={value}>
              {t(statusKey[value] ?? 'statusBot')}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('channelFilter')}
          value={channel}
          onChange={(e) => setParams({ channel: e.target.value || null })}
        >
          <option value="">{tc('all')}</option>
          {Object.keys(channelKey).map((value) => (
            <option key={value} value={value}>
              {value === 'instagram'
                ? 'Instagram'
                : value === 'whatsapp'
                  ? 'WhatsApp'
                  : t(channelKey[value] ?? 'channelInternal')}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('assignmentFilter')}
          value={assignment}
          onChange={(e) => setParams({ assignment: e.target.value || null })}
        >
          <option value="">{t('assignAll')}</option>
          <option value="mine">{t('assignMine')}</option>
          <option value="unassigned">{t('assignUnassigned')}</option>
        </Select>
      </div>

      <div className={`inbox-layout${selectedId ? ' inbox-layout--detail' : ''}`}>
        <div className="inbox-list">
          {listLoading ? (
            <div style={{ padding: 16 }}>
              <Skeleton lines={8} height={40} />
            </div>
          ) : listError ? (
            <ErrorState body={listError} onRetry={() => void loadList()} />
          ) : (conversations ?? []).length === 0 ? (
            <EmptyState icon="inbox" title={t('emptyTitle')} body={t('emptyBody')} />
          ) : (
            <ul className="inbox-list__scroll" role="list" aria-label={t('title')} tabIndex={0}>
              {(conversations ?? []).map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    className={`inbox-item${selectedId === conversation.id ? ' inbox-item--active' : ''}`}
                    onClick={() => setParams({ c: conversation.id })}
                    aria-current={selectedId === conversation.id ? 'true' : undefined}
                  >
                    <span className="inbox-item__top">
                      <span className="inbox-item__name" dir="auto">
                        {conversation.customer.name}
                      </span>
                      <span className="inbox-item__time">
                        {formatRelativeTime(conversation.lastMessageAt, locale)}
                      </span>
                    </span>
                    <span className="inbox-item__preview" dir="auto">
                      {conversation.lastMessagePreview ?? conversation.subject ?? ''}
                    </span>
                    <span className="inbox-item__meta">
                      <Badge tone={statusTone[conversation.status] ?? 'neutral'}>
                        {t(statusKey[conversation.status] ?? 'statusBot')}
                      </Badge>
                      <span className="cell-sub" translate="no">
                        {channelKey[conversation.channel]
                          ? t(channelKey[conversation.channel] ?? 'channelInternal')
                          : conversation.channel}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          {!selectedId ? (
            <div
              className="conversation"
              style={{ alignItems: 'center', justifyContent: 'center' }}
            >
              <EmptyState icon="inbox" title={t('selectConversation')} />
            </div>
          ) : detailLoading && !selected ? (
            <div className="conversation" style={{ padding: 24 }}>
              <Skeleton lines={6} height={20} />
            </div>
          ) : detailError ? (
            <div className="conversation" style={{ padding: 24 }}>
              <ErrorState body={detailError} onRetry={() => void loadConversation(selectedId)} />
            </div>
          ) : selected ? (
            <ConversationView
              conversation={selected}
              onChanged={() => {
                void loadConversation(selected.id);
                void loadList();
              }}
              onBack={() => setParams({ c: null })}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

function ConversationView({
  conversation,
  onChanged,
  onBack,
}: {
  conversation: Conversation;
  onChanged: () => void;
  onBack: () => void;
}) {
  const t = useTranslations('inbox');
  const tc = useTranslations('common');
  const locale = useLocale();
  const api = useApi();
  const tenant = useTenantPath();
  const { toast } = useToast();

  const [reply, setReply] = useState('');
  const [internalNote, setInternalNote] = useState(false);
  const [pending, setPending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canReply = conversation.status !== 'closed';
  const activeHandoff = conversation.activeHandoff;

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || reply.trim().length === 0) return;
    setSendError(null);
    setPending(true);
    try {
      await api.post(tenant(`/conversations/${conversation.id}/messages`), {
        direction: internalNote ? 'internal' : 'outbound',
        senderType: 'agent',
        content: reply.trim(),
      });
      setReply('');
      onChanged();
    } catch {
      setSendError(t('sendFailed'));
    } finally {
      setPending(false);
    }
  }

  async function runAction(path: string, body: Record<string, unknown>, successMessage: string) {
    setActionError(null);
    setPending(true);
    try {
      await api.post(tenant(`/conversations/${conversation.id}${path}`), body);
      toast(successMessage, 'success');
      onChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : tc('errorBody'));
    } finally {
      setPending(false);
    }
  }

  const senderLabel = (message: Message) => {
    const key = `sender${message.senderType === 'customer' ? 'Customer' : message.senderType === 'agent' ? 'Agent' : message.senderType === 'bot' ? 'Bot' : 'System'}`;
    return t(key);
  };

  return (
    <div className="conversation">
      <div className="conversation__header">
        <div className="conversation__title">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="icon-btn icon-btn--sm mobile-back-btn"
              onClick={onBack}
              aria-label={t('backToList')}
            >
              <Icon name="arrow-back" size={17} />
            </button>
            <h2 className="conversation__name" dir="auto">
              {conversation.customer.name}
            </h2>
          </div>
          <div className="conversation__meta">
            <Badge tone={statusTone[conversation.status] ?? 'neutral'}>
              {t(statusKey[conversation.status] ?? 'statusBot')}
            </Badge>
            <span translate="no">
              {channelKey[conversation.channel]
                ? t(channelKey[conversation.channel] ?? 'channelInternal')
                : conversation.channel}
            </span>
            {conversation.customer.contactHint ? (
              <span dir="ltr">{conversation.customer.contactHint}</span>
            ) : null}
          </div>
        </div>
        <div className="conversation__actions">
          {conversation.status === 'needs_human' && !conversation.assignedToMe ? (
            <Button
              size="sm"
              onClick={() =>
                void runAction('/claim', { expectedVersion: conversation.version }, t('claimed'))
              }
              loading={pending}
            >
              {t('claim')}
            </Button>
          ) : null}
          {conversation.status === 'human' && conversation.assignedToMe ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void runAction(
                  '/release',
                  { expectedVersion: conversation.version, reason: 'released by staff' },
                  t('released'),
                )
              }
              loading={pending}
            >
              {t('release')}
            </Button>
          ) : null}
          {conversation.status === 'closed' ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void runAction(
                  '/status',
                  { expectedVersion: conversation.version, targetStatus: 'bot' },
                  t('reopenBot'),
                )
              }
              loading={pending}
            >
              {t('reopenBot')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void runAction(
                  '/status',
                  { expectedVersion: conversation.version, targetStatus: 'closed' },
                  t('closed'),
                )
              }
              loading={pending}
            >
              {t('closeConversation')}
            </Button>
          )}
        </div>
      </div>

      {activeHandoff ? (
        <div className="handoff-banner">
          <InlineAlert kind="warning">
            <strong>{t('handoffBanner', { reason: t(reasonKey[activeHandoff.reason]) })}</strong>
            {activeHandoff.status === 'pending' ? (
              <>
                {' '}
                —{' '}
                {t('handoffWaiting', {
                  duration: formatDurationSeconds(activeHandoff.currentWaitSeconds, locale),
                })}
              </>
            ) : null}
          </InlineAlert>
        </div>
      ) : null}

      {actionError ? (
        <div style={{ padding: '8px 16px' }}>
          <InlineAlert kind="error">{actionError}</InlineAlert>
        </div>
      ) : null}

      <div
        className="conversation__messages"
        role="log"
        aria-label={t('title')}
        aria-live="polite"
        tabIndex={0}
      >
        {conversation.messages.length === 0 ? (
          <p className="meta-text" style={{ textAlign: 'center' }}>
            {t('noMessages')}
          </p>
        ) : (
          conversation.messages.map((message) => (
            <div
              key={message.id}
              className={`message message--${message.direction === 'internal' ? 'internal' : message.direction}`}
            >
              {message.direction === 'internal' ? (
                <Badge tone="warning">{t('internalNoteTag')}</Badge>
              ) : null}
              <div dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
                {message.content}
              </div>
              <div className="message__meta">
                {senderLabel(message)} · {formatRelativeTime(message.createdAt, locale)}
              </div>
            </div>
          ))
        )}
      </div>

      {(conversation.orderId || conversation.productId) && (
        <div
          style={{
            padding: '8px 16px',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          {conversation.orderId ? (
            <Link href={`/orders/${conversation.orderId}`} className="meta-text">
              {t('linkedOrder')}
            </Link>
          ) : null}
          {conversation.productId ? (
            <Link href={`/products/${conversation.productId}`} className="meta-text">
              {t('linkedProduct')}
            </Link>
          ) : null}
        </div>
      )}

      {canReply ? (
        <form className="conversation__composer" onSubmit={sendMessage}>
          {sendError ? <InlineAlert kind="error">{sendError}</InlineAlert> : null}
          <Checkbox
            label={t('asInternalNote')}
            checked={internalNote}
            onChange={(e) => setInternalNote(e.target.checked)}
          />
          <div className="conversation__composer-row">
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={internalNote ? t('internalNotePlaceholder') : t('replyPlaceholder')}
              aria-label={internalNote ? t('internalNotePlaceholder') : t('replyPlaceholder')}
              rows={2}
              maxLength={20000}
            />
            <Button
              type="submit"
              loading={pending}
              disabled={reply.trim().length === 0}
              icon={<Icon name="send" size={16} />}
            >
              {internalNote ? t('addInternalNote') : t('sendReply')}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
