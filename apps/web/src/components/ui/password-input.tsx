'use client';

import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '../icons';

export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function PasswordInput({ className, autoComplete, ...rest }, ref) {
    const t = useTranslations('common');
    const [visible, setVisible] = useState(false);
    return (
      <div className="input-group">
        <input
          ref={ref}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          className={['input', className ?? ''].filter(Boolean).join(' ')}
          {...rest}
        />
        <span className="input-group__addon">
          <button
            type="button"
            className="icon-btn"
            aria-label={visible ? t('hidePassword') : t('showPassword')}
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
          >
            <Icon name={visible ? 'eye-off' : 'eye'} size={18} />
          </button>
        </span>
      </div>
    );
  },
);
