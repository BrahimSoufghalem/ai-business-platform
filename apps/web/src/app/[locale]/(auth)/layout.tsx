import { Suspense, type ReactNode } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '../../../i18n/navigation';
import { LocaleSwitcher } from '../../../components/shell/locale-switcher';

export default async function AuthLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'legal' });

  return (
    <main className="auth-layout">
      <div className="auth-locale">
        <Suspense>
          <LocaleSwitcher />
        </Suspense>
      </div>
      {children}
      <footer className="auth-legal">
        <Link href="/privacy">{t('nav.privacy')}</Link>
        <Link href="/terms">{t('nav.terms')}</Link>
        <Link href="/data-deletion">{t('nav.dataDeletion')}</Link>
      </footer>
    </main>
  );
}
