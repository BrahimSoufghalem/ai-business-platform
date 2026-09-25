import { getTranslations } from 'next-intl/server';
import { PageHeader } from '../../../../../components/ui/page-header';
import { Breadcrumbs } from '../../../../../components/ui/breadcrumbs';
import { ProductForm } from '../product-form';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'products' });
  return { title: t('newProduct') };
}

export default async function NewProductPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'products' });
  return (
    <>
      <PageHeader
        title={t('newProduct')}
        breadcrumb={
          <Breadcrumbs
            items={[{ label: t('title'), href: '/products' }, { label: t('newProduct') }]}
          />
        }
      />
      <ProductForm product={null} />
    </>
  );
}
