import { Link } from '../../i18n/navigation';
import { Icon } from '../icons';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment } from 'react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  const locale = useLocale();
  const t = useTranslations('common');
  return (
    <nav className="breadcrumbs" aria-label={t('breadcrumbs')}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <Fragment key={`${item.label}-${index}`}>
            {index > 0 ? (
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-flex',
                  transform: locale === 'ar' ? 'scaleX(-1)' : undefined,
                }}
              >
                <Icon name="chevron-forward" size={14} />
              </span>
            ) : null}
            {item.href && !isLast ? (
              <Link href={item.href}>{item.label}</Link>
            ) : (
              <span aria-current={isLast ? 'page' : undefined}>{item.label}</span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
