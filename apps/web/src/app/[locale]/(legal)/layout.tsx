import { Suspense, type ReactNode } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '../../../i18n/navigation';
import { BrandLockup } from '../../../components/brand';
import { LocaleSwitcher } from '../../../components/shell/locale-switcher';

/** Public chrome for the legal pages: brand header, locale switcher, footer. */
export default async function LegalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'legal' });
  const tAuth = await getTranslations({ locale, namespace: 'auth' });
  const email = t('contactEmail');
  const year = new Date().getFullYear();

  return (
    <div className="legal-shell">
      <header className="legal-header">
        <div className="legal-header__inner">
          <Link href="/" className="legal-header__brand" aria-label="Noxi">
            <BrandLockup />
          </Link>
          <span className="legal-header__spacer" />
          <Suspense>
            <LocaleSwitcher />
          </Suspense>
          <Link href="/login" className="btn btn--secondary btn--sm">
            {tAuth('signIn')}
          </Link>
        </div>
      </header>

      <main className="legal-main">{children}</main>

      <footer className="legal-footer">
        <div className="legal-footer__inner">
          <div className="legal-footer__brand">
            <BrandLockup />
            <p className="legal-footer__tagline">{t('footer.tagline')}</p>
          </div>
          <div className="legal-footer__cols">
            <nav className="legal-footer__col" aria-label={t('navLabel')}>
              <span className="legal-footer__col-title">{t('footer.legal')}</span>
              <Link href="/privacy">{t('nav.privacy')}</Link>
              <Link href="/terms">{t('nav.terms')}</Link>
              <Link href="/data-deletion">{t('nav.dataDeletion')}</Link>
            </nav>
            <div className="legal-footer__col">
              <span className="legal-footer__col-title">{t('footer.contact')}</span>
              <a href={`mailto:${email}`} dir="ltr">
                {email}
              </a>
            </div>
          </div>
        </div>
        <div className="legal-footer__bottom">
          <div className="legal-footer__bottom-inner">
            <span>© {year} Noxi</span>
            <span>{t('footer.rights')}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
