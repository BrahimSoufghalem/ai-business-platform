'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '../icons';

export const SearchInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function SearchInput({ className, placeholder, ...rest }, ref) {
    const t = useTranslations('common');
    return (
      <div className={['search-input', className ?? ''].filter(Boolean).join(' ')}>
        <span className="search-input__icon">
          <Icon name="search" size={17} />
        </span>
        <input
          ref={ref}
          type="search"
          role="searchbox"
          placeholder={placeholder ?? t('search')}
          className="input"
          {...rest}
        />
      </div>
    );
  },
);
