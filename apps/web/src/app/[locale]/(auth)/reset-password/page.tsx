'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '../../../../i18n/navigation';
import { getSupabaseBrowserClient } from '../../../../lib/supabase/client';
import { Button } from '../../../../components/ui/button';
import { FormField } from '../../../../components/ui/form-field';
import { PasswordInput } from '../../../../components/ui/password-input';
import { InlineAlert } from '../../../../components/ui/alert';

export default function ResetPasswordPage() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sessionReady, setSessionReady] = useState<boolean | null>(null);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    void supabase.auth.getSession().then(({ data }) => setSessionReady(Boolean(data.session)));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const nextErrors: typeof errors = {};
    if (password.length < 8) nextErrors.password = t('passwordTooShort');
    if (password !== confirmPassword) nextErrors.confirm = t('passwordMismatch');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setFormError(null);
    setPending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setFormError(t('resetFailed'));
        return;
      }
      router.replace(`/${locale}/overview`);
      router.refresh();
    } catch {
      setFormError(t('genericError'));
    } finally {
      setPending(false);
    }
  }

  if (sessionReady === false) {
    return (
      <div className="auth-card">
        <h1 className="auth-card__title">{t('resetTitle')}</h1>
        <InlineAlert kind="error">{t('resetLinkInvalid')}</InlineAlert>
        <p className="auth-card__footer">
          <Link href="/forgot-password">{t('requestNewLink')}</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <p className="auth-card__brand" translate="no">
        AI Business Platform
      </p>
      <h1 className="auth-card__title">{t('resetTitle')}</h1>
      <p className="auth-card__subtitle">{t('resetSubtitle')}</p>
      {formError ? <InlineAlert kind="error">{formError}</InlineAlert> : null}
      <form onSubmit={onSubmit} noValidate>
        <FormField label={t('newPassword')} required error={errors.password} hint={t('passwordHint')}>
          <PasswordInput
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </FormField>
        <FormField label={t('confirmPassword')} required error={errors.confirm}>
          <PasswordInput
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
          />
        </FormField>
        <Button type="submit" loading={pending} className="btn--block" disabled={sessionReady !== true}>
          {t('setNewPassword')}
        </Button>
      </form>
    </div>
  );
}
