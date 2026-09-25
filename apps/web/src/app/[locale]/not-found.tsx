import { useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';
import { EmptyState } from '../../components/ui/empty-state';

export default function NotFound() {
  const t = useTranslations('errors');
  return (
    <main className="auth-layout">
      <EmptyState icon="search" title={t('notFoundTitle')} body={t('notFoundBody')} />
      <Link href="/overview" className="btn btn--secondary">
        {t('backToOverview')}
      </Link>
    </main>
  );
}
