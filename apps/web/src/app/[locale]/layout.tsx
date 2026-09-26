import type { Metadata } from 'next';
import { type ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Inter, IBM_Plex_Sans_Arabic } from 'next/font/google';
import { routing, localeDirection } from '../../i18n/routing';
import '../../styles/tokens.css';
import '../../styles/base.css';
import '../../styles/components.css';
import '../../styles/shell.css';
import '../../styles/pages.css';
import '../../styles/legal.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-arabic',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Noxi', template: '%s — Noxi' },
  description:
    'Noxi is a business management and customer communication platform for managing products, inventory, orders, customers, and conversations across messaging channels.',
  applicationName: 'Noxi',
  openGraph: {
    type: 'website',
    siteName: 'Noxi',
    title: 'Noxi — Business management and customer communication',
    description:
      'Manage products, inventory, orders, customers, and conversations in one platform, with Instagram messaging integration and AI-assisted replies grounded in your data.',
  },
  twitter: {
    card: 'summary',
    title: 'Noxi — Business management and customer communication',
    description:
      'Manage products, inventory, orders, customers, and conversations in one platform, with Instagram messaging integration and AI-assisted replies grounded in your data.',
  },
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      dir={localeDirection[locale]}
      className={`${inter.variable} ${plexArabic.variable}`}
    >
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
