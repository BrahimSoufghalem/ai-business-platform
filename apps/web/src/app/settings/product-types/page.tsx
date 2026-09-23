import type { Metadata } from 'next';
import { ProductTypeStudio } from './product-type-studio';

export const metadata: Metadata = {
  title: 'أنواع المنتجات | AI Business Platform',
  description: 'إنشاء أنواع منتجات وقوالب وخصائص ديناميكية دون تعديل النظام الأساسي.',
};

export default function ProductTypesPage() {
  return <ProductTypeStudio />;
}
