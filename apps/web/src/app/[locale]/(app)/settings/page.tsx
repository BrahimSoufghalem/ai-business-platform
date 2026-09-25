import { getTranslations } from 'next-intl/server';
import { SettingsPage } from './settings-page';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'settings' });
  return { title: t('title') };
}

export default function Settings() {
  return <SettingsPage />;
}
