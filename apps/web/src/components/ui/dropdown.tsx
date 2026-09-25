'use client';

import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { Icon } from '../icons';

export function Dropdown({ trigger, children, label }: { trigger: ReactNode; children: ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>('[data-trigger]')?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        type="button"
        data-trigger
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className="icon-btn"
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open ? (
        <div className="dropdown__menu" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function DropdownItem({
  icon,
  danger,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: Parameters<typeof Icon>[0]['name']; danger?: boolean }) {
  const IconComponent = icon ? <Icon name={icon} size={16} /> : null;
  return (
    <button
      type="button"
      role="menuitem"
      className={['dropdown__item', danger ? 'dropdown__item--danger' : ''].filter(Boolean).join(' ')}
      {...rest}
    >
      {IconComponent}
      <span>{children}</span>
    </button>
  );
}

export function DropdownSeparator() {
  return <div className="dropdown__separator" role="separator" />;
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return <div className="dropdown__label">{children}</div>;
}

export function MoreActionsDropdown({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Dropdown label={label} trigger={<Icon name="more" size={18} />}>
      {children}
    </Dropdown>
  );
}
