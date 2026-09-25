import { getTranslations } from 'next-intl/server';
import { CustomerDetails } from './customer-details';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'customers' });
  return { title: t('title') };
}

export default function CustomerDetailsPage() {
  return <CustomerDetails />;
}
