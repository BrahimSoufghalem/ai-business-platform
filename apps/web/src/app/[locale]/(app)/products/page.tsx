import { getTranslations } from 'next-intl/server';
import { ProductsTable } from './products-table';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'products' });
  return { title: t('title') };
}

export default function ProductsPage() {
  return <ProductsTable />;
}
