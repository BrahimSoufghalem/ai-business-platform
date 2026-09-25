'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '../../../../i18n/navigation';
import { getSupabaseBrowserClient } from '../../../../lib/supabase/client';
import { Button } from '../../../../components/ui/button';
import { FormField } from '../../../../components/ui/form-field';
import { Input } from '../../../../components/ui/input';
import { PasswordInput } from '../../../../components/ui/password-input';
import { InlineAlert } from '../../../../components/ui/alert';

export function LoginForm() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(mapAuthError(signInError.message, t));
        return;
      }
      const next = searchParams.get('next');
      const target =
        next && next.startsWith('/') && !next.startsWith('//') ? next : `/${locale}/overview`;
      router.replace(target);
      router.refresh();
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
      <h1 className="auth-card__title">{t('loginTitle')}</h1>
      <p className="auth-card__subtitle">{t('loginSubtitle')}</p>
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
        <FormField label={t('password')} required>
          <PasswordInput
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </FormField>
        <div className="auth-links">
          <Link href="/forgot-password">{t('forgotPassword')}</Link>
        </div>
        <Button type="submit" loading={pending} className="btn--block">
          {t('signIn')}
        </Button>
      </form>
      <p className="auth-card__footer">
        {t('noAccount')} <Link href="/signup">{t('createAccount')}</Link>
      </p>
    </div>
  );
}

function mapAuthError(message: string, t: ReturnType<typeof useTranslations<'auth'>>): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login') || normalized.includes('invalid credentials'))
    return t('invalidCredentials');
  if (normalized.includes('email not confirmed')) return t('emailNotConfirmed');
  if (normalized.includes('rate limit') || normalized.includes('too many')) return t('rateLimited');
  return t('genericError');
}
