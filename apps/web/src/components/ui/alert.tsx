import type { ReactNode } from 'react';
import { Icon } from '../icons';

export function InlineAlert({
  kind = 'info',
  children,
}: {
  kind?: 'info' | 'success' | 'warning' | 'error';
  children: ReactNode;
}) {
  const icon =
    kind === 'error'
      ? 'alert-circle'
      : kind === 'warning'
        ? 'alert-triangle'
        : kind === 'success'
          ? 'check-circle'
          : 'info';
  return (
    <div className={`alert alert--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon name={icon} size={18} />
      <div>{children}</div>
    </div>
  );
}
