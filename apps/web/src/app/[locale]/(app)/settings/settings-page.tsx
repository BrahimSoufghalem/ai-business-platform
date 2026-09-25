'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useApi, useSession, useStore, useTenantPath } from '../../../../components/providers';
import { useAsyncData } from '../../../../lib/use-async-data';
import { formatDateTime } from '../../../../lib/format';
import { ApiError } from '../../../../lib/api/client';
import type { AuditEventSummary } from '../../../../lib/api/types';
import { getSupabaseBrowserClient } from '../../../../lib/supabase/client';
import { PageHeader } from '../../../../components/ui/page-header';
import { Tabs } from '../../../../components/ui/tabs';
import { Button } from '../../../../components/ui/button';
import { InlineAlert } from '../../../../components/ui/alert';
import { Skeleton } from '../../../../components/ui/skeleton';
import { LocaleSwitcher } from '../../../../components/shell/locale-switcher';
import { useToast } from '../../../../components/ui/toast';
import { ProductTypesStudio } from './product-types-studio';

export function SettingsPage() {
  const t = useTranslations('settings');
  const searchParams = useSearchParams();
  const store = useStore();
  const tab = searchParams.get('tab') ?? 'store';
  const canSeeTypes = store.role === 'owner' || store.role === 'manager';

  const tabs = [
    { id: 'store', label: t('storeTab') },
    ...(canSeeTypes ? [{ id: 'types', label: t('typesTab') }] : []),
    { id: 'language', label: t('languageTab') },
    { id: 'account', label: t('accountTab') },
  ];

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Tabs active={tabs.some((item) => item.id === tab) ? tab : 'store'} items={tabs} />
      {tab === 'store' ? <StoreTab /> : null}
      {tab === 'types' && canSeeTypes ? <ProductTypesStudio /> : null}
      {tab === 'language' ? <LanguageTab /> : null}
      {tab === 'account' ? <AccountTab /> : null}
    </>
  );
}

function StoreTab() {
  const t = useTranslations('settings');
  const tStore = useTranslations('store');
  const tc = useTranslations('common');
  const locale = useLocale();
  const store = useStore();
  const api = useApi();
  const tenant = useTenantPath();

  const auditQuery = useAsyncData<AuditEventSummary[] | 'forbidden'>(
    async (signal) => {
      try {
        return await api.get<AuditEventSummary[]>(`/tenants/${store.id}/audit-events`, { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) return 'forbidden';
        throw error;
      }
    },
    [api, store.id, tenant],
  );

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">{t('storeInfo')}</h2>
        </div>
        <div className="panel__body">
          <dl className="detail-list">
            <dt>{tc('name')}</dt>
            <dd dir="auto">{store.name}</dd>
            <dt>{t('storeRole')}</dt>
            <dd>{tStore(`roles.${store.role}`)}</dd>
            <dt>ID</dt>
            <dd className="num" translate="no" style={{ overflowWrap: 'anywhere' }}>
              {store.id}
            </dd>
          </dl>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">{t('auditTitle')}</h2>
        </div>
        <div className="panel__body">
          {auditQuery.loading ? (
            <Skeleton lines={5} height={16} />
          ) : auditQuery.error ? (
            <InlineAlert kind="error">{tc('loadFailed')}</InlineAlert>
          ) : auditQuery.data === 'forbidden' ? (
            <p className="meta-text">{tc('forbidden')}</p>
          ) : (auditQuery.data ?? []).length === 0 ? (
            <p className="meta-text">{t('auditEmpty')}</p>
          ) : (
            <ul className="stack" style={{ gap: 10 }}>
              {(auditQuery.data ?? []).slice(0, 20).map((event) => (
                <li key={event.id} style={{ fontSize: 'var(--text-md)' }}>
                  <span translate="no" className="meta-text">{event.action}</span>
                  {' · '}
                  <span dir="auto">{event.entityType}</span>
                  {' · '}
                  <span className="meta-text">{formatDateTime(event.createdAt, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function LanguageTab() {
  const t = useTranslations('settings');
  return (
    <section className="panel page-narrow">
      <div className="panel__header">
        <h2 className="panel__title">{t('languageTab')}</h2>
      </div>
      <div className="panel__body stack">
        <div className="field">
          <span className="field__label">{t('interfaceLanguage')}</span>
          <div>
            <LocaleSwitcher />
          </div>
          <p className="field__hint">{t('interfaceLanguageHint')}</p>
        </div>
      </div>
    </section>
  );
}

function AccountTab() {
  const t = useTranslations('settings');
  const locale = useLocale();
  const { user } = useSession();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  async function sendReset() {
    if (pending || !user.email) return;
    setPending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/${locale}/auth/callback?next=/${locale}/reset-password`,
      });
      toast(t('passwordResetSent'), 'success');
    } finally {
      setPending(false);
    }
  }

  const displayName = (user.user_metadata?.full_name as string | undefined) ?? '—';

  return (
    <div className="grid-2 page-narrow" style={{ alignItems: 'start' }}>
      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">{t('accountInfo')}</h2>
        </div>
        <div className="panel__body">
          <dl className="detail-list">
            <dt>{t('accountName')}</dt>
            <dd dir="auto">{displayName}</dd>
            <dt>{t('accountEmail')}</dt>
            <dd dir="ltr" style={{ textAlign: 'start' }}>{user.email ?? '—'}</dd>
          </dl>
        </div>
      </section>
      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">{t('security')}</h2>
        </div>
        <div className="panel__body stack">
          <p className="meta-text">{t('securityBody')}</p>
          <div>
            <Button variant="secondary" onClick={() => void sendReset()} loading={pending}>
              {t('sendPasswordReset')}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
