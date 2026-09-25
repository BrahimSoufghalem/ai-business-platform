import { getTranslations } from 'next-intl/server';
import { OrderDetails } from './order-details';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'orders' });
  return { title: t('title') };
}

export default function OrderDetailsPage() {
  return <OrderDetails />;
}
