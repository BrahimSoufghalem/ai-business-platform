import { getTranslations } from 'next-intl/server';
import { InventoryStudio } from './inventory-studio';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'inventory' });
  return { title: t('title') };
}

export default function InventoryPage() {
  return <InventoryStudio />;
}
