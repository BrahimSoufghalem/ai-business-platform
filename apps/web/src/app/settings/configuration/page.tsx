import type { Metadata } from 'next';
import { ConfigurationStudio } from './configuration-studio';

export const metadata: Metadata = {
  title: 'مركز القواعد والمعرفة | AI Business Platform',
  description: 'إدارة قواعد التسعير والمعرفة وإعدادات الوكيل بإصدارات آمنة.',
};

export default function ConfigurationPage() {
  return <ConfigurationStudio />;
}
