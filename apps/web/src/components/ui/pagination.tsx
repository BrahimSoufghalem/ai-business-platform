'use client';

import { useTranslations } from 'next-intl';
import { formatNumber } from '../../lib/format';
import { useLocale } from 'next-intl';
import { IconButton } from './icon-button';

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number | null;
  onPageChange: (page: number) => void;
  hasMore?: boolean;
}

/** Offset pagination over APIs that return bounded lists. */
export function Pagination({ page, pageSize, total, onPageChange, hasMore }: PaginationProps) {
  const t = useTranslations('common');
  const locale = useLocale();
  const totalPages = total !== null ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const canGoNext = hasMore ?? (totalPages !== null ? page < totalPages : false);

  return (
    <nav className="pagination" aria-label={t('pagination')}>
      <span className="pagination__info">
        {total !== null
          ? t('pageOfTotal', { page: formatNumber(page, locale), total: formatNumber(totalPages ?? page, locale) })
          : t('pageOnly', { page: formatNumber(page, locale) })}
      </span>
      <div className="pagination__controls">
        <IconButton
          icon="arrow-back"
          size="sm"
          label={t('previousPage')}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          style={{ transform: locale === 'ar' ? 'scaleX(-1)' : undefined }}
        />
        <IconButton
          icon="arrow-back"
          size="sm"
          label={t('nextPage')}
          disabled={!canGoNext}
          onClick={() => onPageChange(page + 1)}
          style={{ transform: locale === 'ar' ? 'none' : 'scaleX(-1)' }}
        />
      </div>
    </nav>
  );
}
