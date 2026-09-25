import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';

export function EmptyState({
  icon = 'inbox',
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-box">
      <div className="state-box__icon">
        <Icon name={icon} size={22} />
      </div>
      <p className="state-box__title">{title}</p>
      {body ? <p className="state-box__body">{body}</p> : null}
      {action}
    </div>
  );
}
