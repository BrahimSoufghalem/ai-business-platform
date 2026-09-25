'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '../../../../i18n/navigation';
import { getSupabaseBrowserClient } from '../../../../lib/supabase/client';
import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
import { FormField } from '../../../../components/ui/form-field';
import { Input } from '../../../../components/ui/input';
import { PasswordInput } from '../../../../components/ui/password-input';
import { InlineAlert } from '../../../../components/ui/alert';

export default function SignupPage() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; terms?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const nextErrors: typeof errors = {};
    if (password.length < 8) nextErrors.password = t('passwordTooShort');
    if (password !== confirmPassword) nextErrors.confirm = t('passwordMismatch');
    if (!acceptedTerms) nextErrors.terms = t('termsRequired');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setFormError(null);
    setPending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const origin = window.location.origin;
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${origin}/${locale}/auth/callback`,
        },
      });
      if (error) {
        setFormError(error.message.toLowerCase().includes('already registered') ? t('emailTaken') : t('genericError'));
        return;
      }
      if (data.session) {
        router.replace(`/${locale}/select-store`);
        router.refresh();
        return;
      }
      router.push(`/${locale}/confirm-email?email=${encodeURIComponent(email)}`);
    } catch {
      setFormError(t('genericError'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-card">
      <p className="auth-card__brand" translate="no">
        AI Business Platform
      </p>
      <h1 className="auth-card__title">{t('signupTitle')}</h1>
      <p className="auth-card__subtitle">{t('signupSubtitle')}</p>
      {formError ? <InlineAlert kind="error">{formError}</InlineAlert> : null}
      <form onSubmit={onSubmit} noValidate>
        <FormField label={t('fullName')} required>
          <Input autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} />
        </FormField>
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
        <FormField label={t('password')} required error={errors.password} hint={t('passwordHint')}>
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
        <div>
          <Checkbox
            label={t('acceptTerms')}
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            aria-invalid={errors.terms ? true : undefined}
          />
          {errors.terms ? (
            <p className="field__error" role="alert">
              {errors.terms}
            </p>
          ) : null}
        </div>
        <Button type="submit" loading={pending} className="btn--block">
          {t('createAccount')}
        </Button>
      </form>
      <p className="auth-card__footer">
        {t('haveAccount')} <Link href="/login">{t('signIn')}</Link>
      </p>
    </div>
  );
}
