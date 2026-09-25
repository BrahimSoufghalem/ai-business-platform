'use client';

import { useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useApi, useTenantPath } from '../../../../../components/providers';
import { useAsyncData } from '../../../../../lib/use-async-data';
import { formatDate, formatDateTime, formatMoney } from '../../../../../lib/format';
import type { CustomerView } from '../../../../../lib/api/types';
import { Link } from '../../../../../i18n/navigation';
import { PageHeader } from '../../../../../components/ui/page-header';
import { Breadcrumbs } from '../../../../../components/ui/breadcrumbs';
import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { Skeleton } from '../../../../../components/ui/skeleton';
import { ErrorState } from '../../../../../components/ui/error-state';
import { ConfirmDialog } from '../../../../../components/ui/confirm-dialog';
import { Textarea } from '../../../../../components/ui/textarea';
import { Tabs } from '../../../../../components/ui/tabs';
import { Icon } from '../../../../../components/icons';
import { useToast } from '../../../../../components/ui/toast';
import { useSearchParams } from 'next/navigation';
import { orderStatusKey, orderStatusTone } from '../../orders/orders-table';
import { useTranslations as useOrdersTranslations } from 'next-intl';
import type { OrderStatus } from '../../../../../lib/api/types';

export function CustomerDetails() {
  const t = useTranslations('customers');
  const tOrders = useOrdersTranslations('orders');
  const tc = useTranslations('common');
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const api = useApi();
  const tenant = useTenantPath();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') ?? 'orders';

  const [confirmArchive, setConfirmArchive] = useState(false);
  const [note, setNote] = useState('');
  const [notePending, setNotePending] = useState(false);

  const query = useAsyncData<CustomerView>((signal) => api.get(tenant(`/customers/${params.id}`), { signal }), [api, tenant, params.id]);
  const customer = query.data;

  async function toggleArchive() {
    if (!customer) return;
    const nextStatus = customer.status === 'archived' ? 'active' : 'archived';
    await api.put(tenant(`/customers/${customer.id}`), { expectedVersion: customer.version, status: nextStatus });
    toast(nextStatus === 'archived' ? t('archived') : t('activated'), 'success');
    query.reload();
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customer || note.trim().length < 2 || notePending) return;
    setNotePending(true);
    try {
      await api.post(tenant(`/customers/${customer.id}/notes`), { body: note.trim() });
      setNote('');
      toast(t('noteAdded'), 'success');
      query.reload();
    } finally {
      setNotePending(false);
    }
  }

  if (query.loading) {
    return (
      <div className="stack">
        <Skeleton height={36} width="30%" />
        <Skeleton lines={5} height={18} />
      </div>
    );
  }

  if (query.error || !customer) return <ErrorState onRetry={query.reload} />;

  return (
    <>
      <PageHeader
        title={<span dir="auto">{customer.name}</span>}
        breadcrumb={<Breadcrumbs items={[{ label: t('title'), href: '/customers' }, { label: customer.name }]} />}
        actions={
          <Button variant="secondary" onClick={() => setConfirmArchive(true)} icon={<Icon name="trash" size={16} />}>
            {customer.status === 'archived' ? t('activateCustomer') : tc('archive')}
          </Button>
        }
      />

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="panel">
          <div className="panel__header">
            <h2 className="panel__title">{t('contactInfo')}</h2>
            <Badge tone={customer.status === 'active' ? 'success' : 'neutral'}>
              {customer.status === 'active' ? t('statusActive') : t('statusArchived')}
            </Badge>
          </div>
          <div className="panel__body">
            <dl className="detail-list">
              {customer.contacts.map((contact) => (
                <div key={contact.id} style={{ display: 'contents' }}>
                  <dt>
                    <span translate="no">{contact.type}</span>
                    {contact.isPrimary ? ' ★' : ''}
                  </dt>
                  <dd dir="ltr" style={{ textAlign: 'start' }}>{contact.maskedValue}</dd>
                </div>
              ))}
              <dt>{t('customerSince')}</dt>
              <dd>{formatDate(customer.createdAt, locale)}</dd>
            </dl>
            {customer.addresses.length > 0 ? (
              <>
                <h3 style={{ marginBlock: '16px 8px' }}>{t('addresses')}</h3>
                <ul className="stack" style={{ gap: 8 }}>
                  {customer.addresses.map((address) => (
                    <li key={address.id} dir="auto" className="meta-text">
                      {[address.recipientName, address.line1, address.city, address.region, address.postalCode, address.countryCode]
                        .filter(Boolean)
                        .join('، ')}
                      {address.isDefault ? ` (${t('defaultAddress')})` : ''}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </section>

        <section className="panel" style={{ minWidth: 0 }}>
          <div className="panel__body panel__body--flush" style={{ padding: 0 }}>
            <div style={{ padding: '12px 16px 0' }}>
              <Tabs
                active={tab}
                items={[
                  { id: 'orders', label: `${t('ordersTab')} (${customer.orders.length})` },
                  { id: 'conversations', label: `${t('conversationsTab')} (${customer.conversations.length})` },
                  { id: 'notes', label: `${t('notesTab')} (${customer.notes.length})` },
                ]}
              />
            </div>
            <div className="panel__body">
              {tab === 'orders' ? (
                customer.orders.length === 0 ? (
                  <p className="meta-text">{t('noOrders')}</p>
                ) : (
                  <ul className="stack" style={{ gap: 8 }}>
                    {customer.orders.map((order) => (
                      <li key={order.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <Link href={`/orders/${order.id}`} className="num" translate="no">
                          {order.number}
                        </Link>
                        <Badge tone={orderStatusTone[order.status as OrderStatus] ?? 'neutral'}>
                          {orderStatusKey[order.status as OrderStatus] ? tOrders(orderStatusKey[order.status as OrderStatus]) : order.status}
                        </Badge>
                        <span className="num">{formatMoney(order.total, order.currency, locale)}</span>
                        <span className="meta-text">{formatDate(order.createdAt, locale)}</span>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}

              {tab === 'conversations' ? (
                customer.conversations.length === 0 ? (
                  <p className="meta-text">{t('noConversations')}</p>
                ) : (
                  <ul className="stack" style={{ gap: 8 }}>
                    {customer.conversations.map((conversation) => (
                      <li key={conversation.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <Link href={`/inbox?c=${conversation.id}`}>
                          <span dir="auto">{conversation.subject ?? t('viewConversation')}</span>
                        </Link>
                        <span translate="no" className="meta-text">{conversation.channel}</span>
                        <span className="meta-text">
                          {conversation.lastMessageAt ? formatDateTime(conversation.lastMessageAt, locale) : formatDate(conversation.createdAt, locale)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}

              {tab === 'notes' ? (
                <div className="stack">
                  {customer.notes.length === 0 ? <p className="meta-text">{t('noNotes')}</p> : null}
                  <ul className="stack" style={{ gap: 12 }}>
                    {customer.notes.map((noteItem) => (
                      <li key={noteItem.id}>
                        <p dir="auto" style={{ overflowWrap: 'anywhere' }}>{noteItem.body}</p>
                        <p className="meta-text">{formatDateTime(noteItem.createdAt, locale)}</p>
                      </li>
                    ))}
                  </ul>
                  <form onSubmit={addNote} className="stack">
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={t('notePlaceholder')}
                      rows={3}
                      maxLength={4000}
                      aria-label={t('addNote')}
                    />
                    <div>
                      <Button type="submit" variant="secondary" loading={notePending} disabled={note.trim().length < 2}>
                        {t('addNote')}
                      </Button>
                    </div>
                  </form>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={toggleArchive}
        title={customer.status === 'archived' ? t('activateCustomer') : t('archiveTitle')}
        body={t('archiveBody', { name: customer.name })}
        danger={customer.status !== 'archived'}
      />
    </>
  );
}
