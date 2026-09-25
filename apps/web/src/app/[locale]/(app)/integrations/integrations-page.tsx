'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useApi, useStore, useTenantPath } from '../../../../components/providers';
import { useAsyncData } from '../../../../lib/use-async-data';
import { formatDateTime } from '../../../../lib/format';
import { ApiError } from '../../../../lib/api/client';
import type { InstagramConnectionView } from '../../../../lib/api/types';
import { PageHeader } from '../../../../components/ui/page-header';
import { Badge, type BadgeTone } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Dialog } from '../../../../components/ui/dialog';
import { ConfirmDialog } from '../../../../components/ui/confirm-dialog';
import { FormField } from '../../../../components/ui/form-field';
import { Input } from '../../../../components/ui/input';
import { PasswordInput } from '../../../../components/ui/password-input';
import { InlineAlert } from '../../../../components/ui/alert';
import { Skeleton } from '../../../../components/ui/skeleton';
import { ErrorState } from '../../../../components/ui/error-state';
import { Icon } from '../../../../components/icons';
import { useToast } from '../../../../components/ui/toast';

const statusTone: Record<string, BadgeTone> = {
  active: 'success',
  disabled: 'neutral',
  reauthorization_required: 'warning',
};

export function IntegrationsPage() {
  const t = useTranslations('integrations');
  const locale = useLocale();
  const api = useApi();
  const tenant = useTenantPath();
  const store = useStore();
  const { toast } = useToast();
  const isOwner = store.role === 'owner';

  const [connectOpen, setConnectOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const query = useAsyncData<InstagramConnectionView | null>(
    async (signal) => {
      try {
        return await api.get<InstagramConnectionView>(tenant('/integrations/instagram'), {
          signal,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    [api, tenant],
  );

  async function disconnect() {
    await api.delete(tenant('/integrations/instagram'));
    toast(t('disconnected'), 'success');
    query.reload();
  }

  const connection = query.data;

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />

      {!isOwner ? <InlineAlert kind="info">{t('ownerOnly')}</InlineAlert> : null}

      <div className="section-stack mt-4">
        <div className="integration-row">
          <div className="integration-row__icon" aria-hidden="true">
            <Icon name="instagram" size={24} />
          </div>
          <div className="integration-row__body">
            <p className="integration-row__name">
              <span translate="no">{t('instagramName')}</span>
              {query.loading ? null : connection ? (
                <Badge tone={statusTone[connection.status] ?? 'neutral'}>
                  {connection.status === 'active'
                    ? t('statusActive')
                    : connection.status === 'disabled'
                      ? t('statusDisabled')
                      : t('statusReauthorization')}
                </Badge>
              ) : (
                <Badge tone="neutral">{t('statusNotConnected')}</Badge>
              )}
            </p>
            <p className="integration-row__meta">{t('instagramDescription')}</p>
            {query.loading ? (
              <Skeleton height={14} width="60%" />
            ) : connection ? (
              <dl className="detail-list mt-4">
                <dt>{t('account')}</dt>
                <dd className="num" translate="no">
                  ID {t('accountSuffix', { suffix: connection.accountIdSuffix })}
                </dd>
                <dt>{t('tokenHealth')}</dt>
                <dd>
                  {connection.lastValidatedAt ? (
                    <Badge tone="success">{t('tokenOk')}</Badge>
                  ) : (
                    <Badge tone="neutral">{t('tokenUnknown')}</Badge>
                  )}
                </dd>
                <dt>{t('connectedAt')}</dt>
                <dd>{formatDateTime(connection.connectedAt, locale)}</dd>
                {connection.lastValidatedAt ? (
                  <>
                    <dt>{t('lastValidated')}</dt>
                    <dd>{formatDateTime(connection.lastValidatedAt, locale)}</dd>
                  </>
                ) : null}
              </dl>
            ) : null}
          </div>
          {isOwner ? (
            <div className="integration-row__actions">
              {connection ? (
                <>
                  {connection.status !== 'active' ? (
                    <Button
                      variant="secondary"
                      onClick={() => setConnectOpen(true)}
                      icon={<Icon name="refresh" size={16} />}
                    >
                      {t('reconnect')}
                    </Button>
                  ) : null}
                  <Button
                    variant="danger-secondary"
                    onClick={() => setConfirmDisconnect(true)}
                    icon={<Icon name="close" size={16} />}
                  >
                    {t('disconnect')}
                  </Button>
                </>
              ) : (
                <Button onClick={() => setConnectOpen(true)} icon={<Icon name="plus" size={16} />}>
                  {t('connect')}
                </Button>
              )}
            </div>
          ) : null}
        </div>

        {query.error ? <ErrorState onRetry={query.reload} /> : null}

        {(['whatsapp', 'messenger'] as const).map((channel) => (
          <div key={channel} className="integration-row">
            <div className="integration-row__icon" aria-hidden="true">
              <Icon name="inbox" size={24} />
            </div>
            <div className="integration-row__body">
              <p className="integration-row__name">
                <span translate="no">
                  {channel === 'whatsapp' ? t('whatsappName') : t('messengerName')}
                </span>
                <Badge tone="neutral">{t('comingSoon')}</Badge>
              </p>
              <p className="integration-row__meta">
                {channel === 'whatsapp' ? t('whatsappDescription') : t('messengerDescription')}
              </p>
            </div>
          </div>
        ))}
      </div>

      <ConnectDialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onDone={() => query.reload()}
      />
      <ConfirmDialog
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={disconnect}
        title={t('disconnectTitle')}
        body={t('disconnectBody')}
        confirmLabel={t('disconnect')}
        danger
      />
    </>
  );
}

function ConnectDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('integrations');
  const tc = useTranslations('common');
  const api = useApi();
  const tenant = useTenantPath();
  const { toast } = useToast();
  const [accountId, setAccountId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      await api.put(tenant('/integrations/instagram'), {
        accountId: accountId.trim(),
        accessToken: accessToken.trim(),
      });
      toast(t('connected'), 'success');
      setAccountId('');
      setAccessToken('');
      onClose();
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('connectFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('connectTitle')}>
      <p className="meta-text" style={{ marginBlock: '8px 0' }}>
        {t('connectBody')}
      </p>
      {error ? (
        <div className="mt-4">
          <InlineAlert kind="error">{error}</InlineAlert>
        </div>
      ) : null}
      <form onSubmit={submit} className="stack mt-4">
        <FormField label={t('igAccountId')} required>
          <Input
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            inputMode="numeric"
            pattern="[0-9]+"
            required
            dir="ltr"
            style={{ textAlign: 'start' }}
          />
        </FormField>
        <FormField label={t('igAccessToken')} required hint={t('igTokenHint')}>
          <PasswordInput
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            required
            minLength={10}
            autoComplete="off"
            dir="ltr"
            style={{ textAlign: 'start' }}
          />
        </FormField>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={pending}>
            {t('connect')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
