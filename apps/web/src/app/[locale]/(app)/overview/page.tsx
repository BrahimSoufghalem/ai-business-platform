import { getTranslations } from 'next-intl/server';
import { OverviewDashboard } from './overview-dashboard';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'overview' });
  return { title: t('title') };
}

export default function OverviewPage() {
  return <OverviewDashboard />;
}
