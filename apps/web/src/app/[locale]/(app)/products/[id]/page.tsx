import { getTranslations } from 'next-intl/server';
import { ProductDetails } from './product-details';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'products' });
  return { title: t('detailsTitle') };
}

export default function ProductDetailsPage() {
  return <ProductDetails />;
}
