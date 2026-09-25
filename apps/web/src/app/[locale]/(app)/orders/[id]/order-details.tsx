'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useApi, useStore, useTenantPath } from '../../../../../components/providers';
import { useAsyncData } from '../../../../../lib/use-async-data';
import { formatDateTime, formatMoney } from '../../../../../lib/format';
import type { OrderStatus, OrderView } from '../../../../../lib/api/types';
import { Link } from '../../../../../i18n/navigation';
import { PageHeader } from '../../../../../components/ui/page-header';
import { Breadcrumbs } from '../../../../../components/ui/breadcrumbs';
import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { DataTable, TableWrap, Td, Th } from '../../../../../components/ui/data-table';
import { Skeleton } from '../../../../../components/ui/skeleton';
import { ErrorState } from '../../../../../components/ui/error-state';
import { Dialog } from '../../../../../components/ui/dialog';
import { Textarea } from '../../../../../components/ui/textarea';
import { FormField } from '../../../../../components/ui/form-field';
import { InlineAlert } from '../../../../../components/ui/alert';
import { Icon } from '../../../../../components/icons';
import { useToast } from '../../../../../components/ui/toast';
import { orderStatusKey, orderStatusTone } from '../orders-table';

/** Allowed transitions mirror apps/api order state machine. */
const NEXT_STATUS: Partial<Record<OrderStatus, { target: OrderStatus; labelKey: string }[]>> = {
  new: [{ target: 'confirmed', labelKey: 'markConfirmed' }],
  confirmed: [{ target: 'preparing', labelKey: 'markPreparing' }],
  preparing: [{ target: 'shipped', labelKey: 'markShipped' }],
  shipped: [{ target: 'delivered', labelKey: 'markDelivered' }],
};

const TIMELINE_STEPS: { status: OrderStatus; atKey: keyof OrderView }[] = [
  { status: 'new', atKey: 'createdAt' },
  { status: 'confirmed', atKey: 'confirmedAt' },
  { status: 'preparing', atKey: 'preparingAt' },
  { status: 'shipped', atKey: 'shippedAt' },
  { status: 'delivered', atKey: 'deliveredAt' },
];

function addressToText(address: Record<string, unknown>): string {
  const parts = [
    address.line1,
    address.line2,
    address.city,
    address.region,
    address.postalCode,
    address.countryCode,
  ].filter((part) => typeof part === 'string' && part.trim().length > 0);
  return parts.join('، ');
}

export function OrderDetails() {
  const t = useTranslations('orders');
  const tc = useTranslations('common');
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const api = useApi();
  const tenant = useTenantPath();
  const store = useStore();
  const { toast } = useToast();
  const canWrite = store.role !== 'agent';

  const [transitionTarget, setTransitionTarget] = useState<OrderStatus | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const query = useAsyncData<OrderView>(
    (signal) => api.get(tenant(`/orders/${params.id}`), { signal }),
    [api, tenant, params.id],
  );
  const order = query.data;

  async function runTransition(target: OrderStatus) {
    if (!order) return;
    setPending(true);
    try {
      await api.post(tenant(`/orders/${order.id}/transition`), {
        targetStatus: target,
        reason: reason.trim() || undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      toast(t('transitionDone'), 'success');
      setTransitionTarget(null);
      setReason('');
      query.reload();
    } finally {
      setPending(false);
    }
  }

  async function cancelOrder() {
    if (!order) return;
    const trimmedReason = cancelReason.trim();
    if (trimmedReason.length < 3) {
      setCancelError(t('cancelReasonRequired'));
      return;
    }
    setPending(true);
    setCancelError(null);
    try {
      await api.post(tenant(`/orders/${order.id}/cancel`), {
        reason: trimmedReason,
        idempotencyKey: crypto.randomUUID(),
      });
      toast(t('cancelled'), 'success');
      setConfirmCancel(false);
      setCancelReason('');
      query.reload();
    } catch {
      setCancelError(t('cancelFailed'));
    } finally {
      setPending(false);
    }
  }

  if (query.loading) {
    return (
      <div className="stack">
        <Skeleton height={36} width="30%" />
        <Skeleton lines={6} height={18} />
      </div>
    );
  }

  if (query.error || !order) return <ErrorState onRetry={query.reload} />;

  const nextActions = canWrite ? (NEXT_STATUS[order.status] ?? []) : [];
  const cancellable = canWrite && order.status !== 'delivered' && order.status !== 'cancelled';

  return (
    <>
      <PageHeader
        title={
          <span translate="no" className="num">
            {order.number}
          </span>
        }
        breadcrumb={
          <Breadcrumbs items={[{ label: t('title'), href: '/orders' }, { label: order.number }]} />
        }
        actions={
          <>
            {nextActions.map((action) => (
              <Button
                key={action.target}
                onClick={() => setTransitionTarget(action.target)}
                icon={<Icon name="check" size={16} />}
              >
                {t(action.labelKey)}
              </Button>
            ))}
            {cancellable ? (
              <Button
                variant="danger-secondary"
                onClick={() => {
                  setCancelReason('');
                  setCancelError(null);
                  setConfirmCancel(true);
                }}
                icon={<Icon name="close" size={16} />}
              >
                {t('cancelOrder')}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid-2">
        <div className="stack">
          <section className="panel">
            <div className="panel__header">
              <h2 className="panel__title">{t('itemsTitle')}</h2>
              <Badge tone="neutral">{t('itemCount', { count: order.items.length })}</Badge>
            </div>
            <div className="panel__body panel__body--flush">
              <TableWrap>
                <DataTable
                  head={
                    <>
                      <Th>{tc('name')}</Th> <Th>SKU</Th> <Th numeric>{tc('quantity')}</Th>{' '}
                      <Th numeric>{tc('price')}</Th> <Th numeric>{t('total')}</Th>
                    </>
                  }
                >
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <Td ellipsis>
                        <span className="cell-main" dir="auto">
                          {item.productName}
                        </span>
                        {item.variantName ? (
                          <span className="cell-sub" dir="auto">
                            {' '}
                            {item.variantName}
                          </span>
                        ) : null}
                      </Td>
                      <Td>
                        <span className="num" translate="no">
                          {item.sku}
                        </span>
                      </Td>
                      <Td numeric>{item.quantity}</Td>
                      <Td numeric>{formatMoney(item.unitPrice, item.currency, locale)}</Td>
                      <Td numeric>{formatMoney(item.lineTotal, item.currency, locale)}</Td>
                    </tr>
                  ))}
                </DataTable>
              </TableWrap>
            </div>
            <div className="panel__body">
              <dl className="detail-list">
                <dt>{t('subtotal')}</dt>
                <dd className="num">{formatMoney(order.subtotal, order.currency, locale)}</dd>
                <dt>{t('discount')}</dt>
                <dd className="num">{formatMoney(order.discountAmount, order.currency, locale)}</dd>
                <dt>{t('shipping')}</dt>
                <dd className="num">{formatMoney(order.shippingAmount, order.currency, locale)}</dd>
                <dt>
                  <strong>{t('total')}</strong>
                </dt>
                <dd className="num">
                  <strong>{formatMoney(order.total, order.currency, locale)}</strong>
                </dd>
              </dl>
            </div>
          </section>

          <section className="panel">
            <div className="panel__header">
              <h2 className="panel__title">{t('timelineTitle')}</h2>
              <Badge tone={orderStatusTone[order.status]}>{t(orderStatusKey[order.status])}</Badge>
            </div>
            <div className="panel__body">
              <ol className="timeline">
                {TIMELINE_STEPS.map((step) => {
                  const at = order[step.atKey] as string | null;
                  const reached = at !== null;
                  const isCurrent = order.status === step.status;
                  return (
                    <li
                      key={step.status}
                      className={`timeline__item${isCurrent ? ' timeline__item--current' : ''}`}
                    >
                      <span
                        className="timeline__dot"
                        aria-hidden="true"
                        style={reached ? { background: 'var(--success)' } : undefined}
                      />
                      <div>
                        <p className="timeline__title">{t(orderStatusKey[step.status])}</p>
                        <p className="timeline__meta">
                          {reached ? formatDateTime(at, locale) : '—'}
                        </p>
                      </div>
                    </li>
                  );
                })}
                {order.status === 'cancelled' ? (
                  <li className="timeline__item timeline__item--current">
                    <span
                      className="timeline__dot"
                      aria-hidden="true"
                      style={{ background: 'var(--danger)' }}
                    />
                    <div>
                      <p className="timeline__title">{t('statusCancelled')}</p>
                      <p className="timeline__meta">
                        {order.cancelledAt ? formatDateTime(order.cancelledAt, locale) : '—'}
                      </p>
                    </div>
                  </li>
                ) : null}
              </ol>
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <div className="panel__header">
              <h2 className="panel__title">{t('customerInfo')}</h2>
            </div>
            <div className="panel__body">
              <dl className="detail-list">
                <dt>{tc('name')}</dt>
                <dd dir="auto">{order.customerName}</dd>
                <dt>{t('colCustomer')}</dt>
                <dd dir="ltr" style={{ textAlign: 'start' }}>
                  {order.customerPhone}
                </dd>
                {order.customerEmail ? (
                  <>
                    <dt>{tc('optional')}</dt>
                    <dd dir="ltr" style={{ textAlign: 'start' }}>
                      {order.customerEmail}
                    </dd>
                  </>
                ) : null}
                <dt>{t('shippingAddress')}</dt>
                <dd dir="auto">{addressToText(order.shippingAddress)}</dd>
                {order.notes ? (
                  <>
                    <dt>{t('orderNotes')}</dt>
                    <dd dir="auto">{order.notes}</dd>
                  </>
                ) : null}
              </dl>
              {order.customerId ? (
                <p className="mt-4">
                  <Link href={`/customers/${order.customerId}`}>{t('customerInfo')} →</Link>
                </p>
              ) : null}
            </div>
          </section>

          {order.transitions.length > 0 ? (
            <section className="panel">
              <div className="panel__header">
                <h2 className="panel__title">{t('timelineTitle')}</h2>
              </div>
              <div className="panel__body">
                <ul className="stack" style={{ gap: 8 }}>
                  {order.transitions.map((transition) => (
                    <li key={transition.id} className="meta-text">
                      {transition.fromStatus ? t(orderStatusKey[transition.fromStatus]) : '—'} ←{' '}
                      {t(orderStatusKey[transition.toStatus])}
                      {' · '}
                      {formatDateTime(transition.createdAt, locale)}
                      {transition.reason ? <span dir="auto"> · {transition.reason}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <Dialog
        open={transitionTarget !== null}
        onClose={() => setTransitionTarget(null)}
        title={
          transitionTarget
            ? t(
                NEXT_STATUS[order.status]?.find((a) => a.target === transitionTarget)?.labelKey ??
                  '',
              )
            : ''
        }
      >
        <FormField label={t('transitionReason')}>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
          />
        </FormField>
        <div className="dialog__actions">
          <Button variant="secondary" onClick={() => setTransitionTarget(null)} disabled={pending}>
            {tc('cancel')}
          </Button>
          <Button
            onClick={() => transitionTarget && runTransition(transitionTarget)}
            loading={pending}
          >
            {tc('confirm')}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={confirmCancel}
        onClose={() => {
          if (!pending) setConfirmCancel(false);
        }}
        title={t('cancelTitle')}
      >
        <p className="meta-text">{t('cancelBody', { number: order.number })}</p>
        {cancelError ? <InlineAlert kind="error">{cancelError}</InlineAlert> : null}
        <FormField label={t('cancelReason')} required>
          <Textarea
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            minLength={3}
            maxLength={500}
            rows={3}
            required
          />
        </FormField>
        <div className="dialog__actions">
          <Button variant="secondary" onClick={() => setConfirmCancel(false)} disabled={pending}>
            {tc('cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => void cancelOrder()}
            loading={pending}
            disabled={cancelReason.trim().length < 3}
          >
            {t('cancelOrder')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
