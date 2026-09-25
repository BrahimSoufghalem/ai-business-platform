'use client';

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { routing, localeLabels, type Locale } from '../../i18n/routing';
import { Icon } from '../icons';

/** Switches locale while preserving the current page and query string. */
export function LocaleSwitcher() {
  const t = useTranslations('common');
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function switchTo(next: Locale) {
    if (next === locale) return;
    const withoutLocale = pathname.replace(/^\/(ar|fr|en)/, '') || '/';
    const query = searchParams.toString();
    document.cookie = `ab_locale=${next};path=/;max-age=31536000`;
    startTransition(() => {
      router.replace(`/${next}${withoutLocale}${query ? `?${query}` : ''}`);
      router.refresh();
    });
  }

  return (
    <div className="dropdown" style={{ position: 'relative' }}>
      <label className="visually-hidden" htmlFor="locale-switcher">
        {t('language')}
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Icon name="globe" size={18} />
        <select
          id="locale-switcher"
          className="select"
          style={{ minHeight: 36, width: 'auto', minWidth: 0 }}
          value={locale}
          disabled={pending}
          onChange={(event) => switchTo(event.target.value as Locale)}
        >
          {routing.locales.map((option) => (
            <option key={option} value={option}>
              {localeLabels[option]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
