import type { IconName } from '../components/icons';
import type { MembershipRole } from './api/types';

export interface NavItem {
  key: string;
  href: string;
  icon: IconName;
  /** Roles allowed to see this item. Server still enforces permissions. */
  roles: readonly MembershipRole[];
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'overview', href: '/overview', icon: 'overview', roles: ['owner', 'manager', 'agent'] },
  { key: 'inbox', href: '/inbox', icon: 'inbox', roles: ['owner', 'manager', 'agent'] },
  { key: 'products', href: '/products', icon: 'package', roles: ['owner', 'manager', 'agent'] },
  { key: 'inventory', href: '/inventory', icon: 'box', roles: ['owner', 'manager', 'agent'] },
  { key: 'orders', href: '/orders', icon: 'shopping-bag', roles: ['owner', 'manager', 'agent'] },
  { key: 'customers', href: '/customers', icon: 'users', roles: ['owner', 'manager', 'agent'] },
  { key: 'agent', href: '/agent', icon: 'bot', roles: ['owner', 'manager', 'agent'] },
  { key: 'integrations', href: '/integrations', icon: 'instagram', roles: ['owner'] },
  { key: 'settings', href: '/settings', icon: 'settings', roles: ['owner', 'manager', 'agent'] },
] as const;

export function navItemsForRole(role: string): NavItem[] {
  return NAV_ITEMS.filter((item) => (item.roles as readonly string[]).includes(role));
}
