'use client';

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';
import { navItemsForRole } from '../../lib/nav';
import { Icon } from '../icons';
import { IconButton } from '../ui/icon-button';
import { useStore } from '../providers';
import { LocaleSwitcher } from './locale-switcher';
import { AccountMenu } from './account-menu';

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const store = useStore();
  const items = navItemsForRole(store.role);
  const locale = useLocale();

  return (
    <nav className="sidebar__nav" aria-label={t('mainNav')}>
      {items.map((item) => {
        const href = `/${locale}${item.href}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={item.key}
            href={item.href}
            className="sidebar__link"
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
          >
            <Icon name={item.icon} size={19} />
            <span>{t(item.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const store = useStore();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  return (
    <div className="shell-layout">
      <a className="skip-link" href="#main-content">
        {t('skipToContent')}
      </a>
      <aside className="sidebar" aria-label={t('sidebar')}>
        <Link href="/overview" className="sidebar__brand">
          <span className="sidebar__brand-mark" aria-hidden="true">
            S
          </span>
          <span translate="no">AI Business Platform</span>
        </Link>
        <NavLinks />
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <IconButton
            icon="menu"
            label={t('openMenu')}
            className="topbar__menu-btn"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
          />
          <Link href="/select-store" className="topbar__store" title={t('switchStore')}>
            <Icon name="store" size={18} />
            <span>{store.name}</span>
            <Icon name="chevron-down" size={15} />
          </Link>
          <span className="topbar__spacer" />
          <Suspense>
            <LocaleSwitcher />
          </Suspense>
          <AccountMenu />
        </header>
        <main id="main-content" className="shell-content">
          {children}
        </main>
      </div>

      {drawerOpen ? (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          <div className="drawer" role="dialog" aria-modal="true" aria-label={t('menu')}>
            <div className="drawer__header">
              <strong translate="no">AI Business Platform</strong>
              <IconButton icon="close" label={t('close')} onClick={() => setDrawerOpen(false)} />
            </div>
            <NavLinks onNavigate={() => setDrawerOpen(false)} />
          </div>
        </>
      ) : null}
    </div>
  );
}
