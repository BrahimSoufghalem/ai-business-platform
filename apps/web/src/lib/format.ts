const localeMap: Record<string, string> = {
  ar: 'ar-DZ',
  fr: 'fr-DZ',
  en: 'en-US',
};

export function intlLocale(locale: string): string {
  return localeMap[locale] ?? 'ar-DZ';
}

export function formatDateTime(
  value: string | null | undefined,
  locale: string,
  timeZone?: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
    ...options,
  }).format(date);
}

export function formatDate(
  value: string | null | undefined,
  locale: string,
  timeZone?: string,
): string {
  return formatDateTime(value, locale, timeZone, { dateStyle: 'medium', timeStyle: undefined });
}

export function formatRelativeTime(
  value: string | null | undefined,
  locale: string,
  timeZone?: string,
): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' });
  if (abs < 90) return rtf.format(Math.trunc(diffSeconds), 'second');
  if (abs < 3600) return rtf.format(Math.trunc(diffSeconds / 60), 'minute');
  if (abs < 86400 * 2) return rtf.format(Math.trunc(diffSeconds / 3600), 'hour');
  return formatDateTime(value, locale, timeZone);
}

export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(value);
}

export function formatMoney(amount: string | number, currency: string, locale: string): string {
  const numeric = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(numeric)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(intlLocale(locale), {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(numeric);
  } catch {
    return `${formatNumber(numeric, locale)} ${currency}`;
  }
}

export function formatDurationSeconds(value: number | null | undefined, locale: string): string {
  if (value === null || value === undefined) return '—';
  const minutes = Math.round(value / 60);
  if (minutes < 1) return `<1 ${locale === 'fr' ? 'min' : locale === 'en' ? 'min' : 'د'}`;
  if (minutes < 60) {
    return `${formatNumber(minutes, locale)} ${locale === 'fr' ? 'min' : locale === 'en' ? 'min' : 'د'}`;
  }
  const hours = Math.round(minutes / 60);
  return `${formatNumber(hours, locale)} ${locale === 'fr' ? 'h' : locale === 'en' ? 'h' : 'س'}`;
}
