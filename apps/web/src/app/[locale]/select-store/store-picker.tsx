'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useApi, useSession } from '../../../components/providers';
import { STORE_COOKIE } from '../../../lib/store';
import type { TenantSummary } from '../../../lib/api/types';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Icon } from '../../../components/icons';
import { ErrorState } from '../../../components/ui/error-state';
import { LocaleSwitcher } from '../../../components/shell/locale-switcher';

const ROLE_TONES: Record<string, string> = { owner: 'owner', manager: 'manager', agent: 'agent' };

export function StorePicker({
  memberships,
  loadFailed,
}: {
  memberships: TenantSummary[];
  loadFailed: boolean;
}) {
  const t = useTranslations('store');
  const tAuth = useTranslations('account');
  const locale = useLocale();
  const router = useRouter();
  const api = useApi();
  const { signOut } = useSession();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [storeLocale, setStoreLocale] = useState(
    locale === 'fr' ? 'fr-DZ' : locale === 'en' ? 'en-US' : 'ar-DZ',
  );
  const [timezone, setTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Algiers';
    } catch {
      return 'Africa/Algiers';
    }
  });

  function choose(storeId: string) {
    document.cookie = `${STORE_COOKIE}=${storeId};path=/;max-age=31536000;samesite=lax`;
    router.push(`/${locale}/overview`);
    router.refresh();
  }

  async function createStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const created = await api.post<TenantSummary>('/tenants', {
        name,
        locale: storeLocale,
        timezone,
      });
      document.cookie = `${STORE_COOKIE}=${created.id};path=/;max-age=31536000;samesite=lax`;
      router.push(`/${locale}/overview`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('createFailed'));
      setPending(false);
    }
  }

  if (loadFailed) {
    return (
      <div className="auth-card">
        <ErrorState
          title={t('loadFailedTitle')}
          body={t('loadFailedBody')}
          onRetry={() => router.refresh()}
        />
      </div>
    );
  }

  return (
    <div style={{ width: 'min(560px, 100%)' }} className="stack">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
        }}
      >
        <p className="auth-card__brand" translate="no" style={{ margin: 0 }}>
          AI Business Platform
        </p>
        <Suspense>
          <LocaleSwitcher />
        </Suspense>
      </div>
      <div>
        <h1 className="auth-card__title">{t('chooseTitle')}</h1>
        <p className="auth-card__subtitle">{t('chooseSubtitle')}</p>
      </div>

      {memberships.length > 0 && (
        <div className="store-list" role="list">
          {memberships.map((membership) => (
            <button
              key={membership.id}
              type="button"
              className="store-card"
              onClick={() => choose(membership.id)}
            >
              <span className="store-card__icon">
                <Icon name="store" size={20} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="store-card__name" style={{ display: 'block' }}>
                  {membership.name}
                </span>
                <span className="store-card__meta">
                  {t(`roles.${ROLE_TONES[membership.role] ?? membership.role}`)}
                </span>
              </span>
              <Icon name="chevron-forward" size={18} />
            </button>
          ))}
        </div>
      )}

      {memberships.length === 0 && !creating ? (
        <div className="panel">
          <div className="panel__body stack">
            <h2 className="panel__title">{t('noStoresTitle')}</h2>
            <p className="meta-text">{t('noStoresBody')}</p>
            <div>
              <Button onClick={() => setCreating(true)} icon={<Icon name="plus" size={16} />}>
                {t('createStore')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {!creating && memberships.length > 0 ? (
        <div style={{ textAlign: 'center' }}>
          <Button variant="ghost" onClick={() => setCreating(true)}>
            {t('createAnother')}
          </Button>
        </div>
      ) : null}

      {creating ? (
        <div className="panel">
          <div className="panel__header">
            <h2 className="panel__title">{t('createStore')}</h2>
          </div>
          <div className="panel__body">
            {error ? (
              <div className="alert alert--error" role="alert">
                {error}
              </div>
            ) : null}
            <form onSubmit={createStore} className="stack mt-4">
              <FormField label={t('storeName')} required>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={120}
                />
              </FormField>
              <div className="form-grid">
                <FormField label={t('storeLocale')} required>
                  <Select value={storeLocale} onChange={(e) => setStoreLocale(e.target.value)}>
                    <option value="ar-DZ">العربية (الجزائر)</option>
                    <option value="fr-DZ">Français (Algérie)</option>
                    <option value="en-US">English (US)</option>
                  </Select>
                </FormField>
                <FormField label={t('storeTimezone')} required>
                  <Input
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    required
                    dir="ltr"
                    style={{ textAlign: 'start' }}
                  />
                </FormField>
              </div>
              <div className="form-actions">
                {memberships.length > 0 ? (
                  <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                    {t('cancel')}
                  </Button>
                ) : null}
                <Button type="submit" loading={pending}>
                  {t('createStore')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <div style={{ textAlign: 'center' }}>
        <Button
          variant="ghost"
          onClick={() => void signOut()}
          icon={<Icon name="logout" size={16} />}
        >
          {tAuth('signOut')}
        </Button>
      </div>
    </div>
  );
}
