'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from '../ui/dropdown';
import { Icon } from '../icons';
import { useSession, useStore } from '../providers';

export function AccountMenu() {
  const t = useTranslations('account');
  const { user, signOut } = useSession();
  const store = useStore();
  const router = useRouter();
  const locale = useLocale();
  const displayName = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? '';

  return (
    <Dropdown label={t('menu')} trigger={<Icon name="users" size={19} />}>
      <DropdownLabel>{t('signedInAs')}</DropdownLabel>
      <div
        style={{
          padding: '0 12px 8px',
          fontSize: 'var(--text-md)',
          fontWeight: 600,
          overflowWrap: 'anywhere',
        }}
      >
        {displayName}
      </div>
      <DropdownLabel>{t('currentStore')}</DropdownLabel>
      <div style={{ padding: '0 12px 8px', fontSize: 'var(--text-md)', overflowWrap: 'anywhere' }}>
        {store.name}
      </div>
      <DropdownSeparator />
      <DropdownItem icon="settings" onClick={() => router.push(`/${locale}/settings`)}>
        {t('settings')}
      </DropdownItem>
      <DropdownItem icon="store" onClick={() => router.push(`/${locale}/select-store`)}>
        {t('switchStore')}
      </DropdownItem>
      <DropdownSeparator />
      <DropdownItem icon="logout" danger onClick={() => void signOut()}>
        {t('signOut')}
      </DropdownItem>
    </Dropdown>
  );
}
