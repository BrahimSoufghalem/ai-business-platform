import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from '../icons';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: 'sm' | 'md';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'md', className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={['icon-btn', size === 'sm' ? 'icon-btn--sm' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 17 : 20} />
    </button>
  );
});
