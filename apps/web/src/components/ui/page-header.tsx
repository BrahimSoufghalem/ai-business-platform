import type { ReactNode } from 'react';
import { formatNumber } from '../../lib/format';
import { useLocale } from 'next-intl';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode | undefined;
  count?: number | undefined;
  actions?: ReactNode | undefined;
  breadcrumb?: ReactNode | undefined;
}

export function PageHeader({ title, description, count, actions, breadcrumb }: PageHeaderProps) {
  const locale = useLocale();
  return (
    <header className="page-header">
      <div className="page-header__titles">
        {breadcrumb}
        <div className="page-header__title">
          <h1>{title}</h1>
          {typeof count === 'number' ? (
            <span className="page-header__count">({formatNumber(count, locale)})</span>
          ) : null}
        </div>
        {description ? <p className="page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}
