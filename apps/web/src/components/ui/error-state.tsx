'use client';

import { useTranslations } from 'next-intl';
import { Icon } from '../icons';
import { Button } from './button';

export function ErrorState({ title, body, onRetry }: { title?: string; body?: string; onRetry?: () => void }) {
  const t = useTranslations('common');
  return (
    <div className="state-box state-box--error" role="alert">
      <div className="state-box__icon">
        <Icon name="alert-circle" size={22} />
      </div>
      <p className="state-box__title">{title ?? t('errorTitle')}</p>
      <p className="state-box__body">{body ?? t('errorBody')}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry} icon={<Icon name="refresh" size={16} />}>
          {t('retry')}
        </Button>
      ) : null}
    </div>
  );
}
