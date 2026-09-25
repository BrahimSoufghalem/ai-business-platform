'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '../../../../i18n/navigation';
import { getSupabaseBrowserClient } from '../../../../lib/supabase/client';
import { Button } from '../../../../components/ui/button';
import { InlineAlert } from '../../../../components/ui/alert';

export function ConfirmEmailContent() {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';
  const [resent, setResent] = useState(false);
  const [pending, setPending] = useState(false);

  async function resend() {
    if (!email || pending) return;
    setPending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.resend({ type: 'signup', email });
      setResent(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-card">
      <h1 className="auth-card__title">{t('confirmTitle')}</h1>
      <p className="auth-card__subtitle">{t('confirmBody', { email })}</p>
      {resent ? <InlineAlert kind="success">{t('confirmResent')}</InlineAlert> : null}
      <div className="form-actions" style={{ justifyContent: 'stretch' }}>
        <Button variant="secondary" onClick={resend} loading={pending} className="btn--block">
          {t('resendConfirmation')}
        </Button>
      </div>
      <p className="auth-card__footer">
        <Link href="/login">{t('backToLogin')}</Link>
      </p>
    </div>
  );
}
