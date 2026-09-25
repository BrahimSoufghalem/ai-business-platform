import { getTranslations } from 'next-intl/server';
import { AgentStudio } from './agent-studio';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'agent' });
  return { title: t('title') };
}

export default function AgentPage() {
  return <AgentStudio />;
}
