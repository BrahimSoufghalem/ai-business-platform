'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '../../../../i18n/navigation';
import { InlineAlert } from '../../../../components/ui/alert';

export function AuthErrorContent() {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason');

  return (
    <div className="auth-card">
      <h1 className="auth-card__title">{t('authErrorTitle')}</h1>
      <InlineAlert kind="error">{reason === 'expired' ? t('resetLinkInvalid') : t('authErrorBody')}</InlineAlert>
      <p className="auth-card__footer">
        <Link href="/login">{t('backToLogin')}</Link>
      </p>
    </div>
  );
}
