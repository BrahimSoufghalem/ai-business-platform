import { getTranslations } from 'next-intl/server';
import { IntegrationsPage } from './integrations-page';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'integrations' });
  return { title: t('title') };
}

export default function Integrations() {
  return <IntegrationsPage />;
}
