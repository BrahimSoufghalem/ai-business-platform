'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '../../../../i18n/navigation';
import { getSupabaseBrowserClient } from '../../../../lib/supabase/client';
import { Button } from '../../../../components/ui/button';
import { FormField } from '../../../../components/ui/form-field';
import { Input } from '../../../../components/ui/input';
import { InlineAlert } from '../../../../components/ui/alert';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const origin = window.location.origin;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/${locale}/auth/callback?next=/${locale}/reset-password`,
      });
      if (resetError) {
        setError(t('genericError'));
        return;
      }
      setSent(true);
    } catch {
      setError(t('genericError'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-card">
      <p className="auth-card__brand" translate="no">
        AI Business Platform
      </p>
      <h1 className="auth-card__title">{t('forgotTitle')}</h1>
      <p className="auth-card__subtitle">{t('forgotSubtitle')}</p>
      {sent ? (
        <>
          <InlineAlert kind="success">{t('resetSent', { email })}</InlineAlert>
          <p className="auth-card__footer">
            <Link href="/login">{t('backToLogin')}</Link>
          </p>
        </>
      ) : (
        <>
          {error ? <InlineAlert kind="error">{error}</InlineAlert> : null}
          <form onSubmit={onSubmit} noValidate>
            <FormField label={t('email')} required>
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                dir="ltr"
                style={{ textAlign: 'start' }}
              />
            </FormField>
            <Button type="submit" loading={pending} className="btn--block">
              {t('sendResetLink')}
            </Button>
          </form>
          <p className="auth-card__footer">
            <Link href="/login">{t('backToLogin')}</Link>
          </p>
        </>
      )}
    </div>
  );
}
