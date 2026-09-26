import { getTranslations } from 'next-intl/server';
import { Link } from '../../i18n/navigation';

export type LegalDocKey = 'privacy' | 'terms' | 'dataDeletion';

interface LegalSection {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
}

interface LegalDocumentContent {
  title: string;
  intro: string;
  sections: LegalSection[];
  contactTitle: string;
  contactBody: string;
}

const DOC_ORDER: LegalDocKey[] = ['privacy', 'terms', 'dataDeletion'];
const DOC_HREFS: Record<LegalDocKey, string> = {
  privacy: '/privacy',
  terms: '/terms',
  dataDeletion: '/data-deletion',
};
const UPDATED_AT = '2026-09-26';

export async function LegalDocument({ locale, doc }: { locale: string; doc: LegalDocKey }) {
  const t = await getTranslations({ locale, namespace: 'legal' });
  const content = t.raw(doc) as LegalDocumentContent;
  const email = t('contactEmail');
  const updated = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
    new Date(`${UPDATED_AT}T00:00:00Z`),
  );

  return (
    <article className="legal-doc">
      <header className="legal-hero">
        <p className="legal-eyebrow">{t('eyebrow')}</p>
        <h1>{content.title}</h1>
        <p className="legal-hero__intro">{content.intro}</p>
        <p className="legal-hero__meta">
          {t('lastUpdated')}: <time dateTime={UPDATED_AT}>{updated}</time>
        </p>
      </header>

      <nav className="legal-nav" aria-label={t('navLabel')}>
        {DOC_ORDER.map((key) => (
          <Link
            key={key}
            href={DOC_HREFS[key]}
            className="legal-nav__item"
            aria-current={key === doc ? 'page' : undefined}
          >
            {t(`nav.${key}`)}
          </Link>
        ))}
      </nav>

      <div className="legal-prose">
        {content.sections.map((section, index) => (
          <section key={section.title} className="legal-section">
            <h2 className="legal-section__title">
              <span className="legal-section__num">{String(index + 1).padStart(2, '0')}</span>
              {section.title}
            </h2>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.bullets ? (
              <ul className="legal-list">
                {section.bullets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}

        <section className="legal-contact">
          <h2>{content.contactTitle}</h2>
          <p>{content.contactBody}</p>
          <a className="legal-contact__email" href={`mailto:${email}`} dir="ltr">
            {email}
          </a>
        </section>
      </div>
    </article>
  );
}
