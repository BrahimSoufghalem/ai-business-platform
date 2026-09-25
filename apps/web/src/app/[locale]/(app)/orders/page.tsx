import { getTranslations } from 'next-intl/server';
import { OrdersTable } from './orders-table';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'orders' });
  return { title: t('title') };
}

export default function OrdersPage() {
  return <OrdersTable />;
}
