import { IconName } from '../core/icon/icon.component';

export interface NavItem {
  /** Translation key (transloco) shown as the nav label. */
  label: string;
  icon: IconName;
  route: string;
}

export const NAV_MAIN: NavItem[] = [
  { label: 'nav.dashboard', icon: 'grid', route: '/dashboard' },
  { label: 'nav.payments', icon: 'money', route: '/payments' },
];

export const NAV_OTHER: NavItem[] = [
  { label: 'nav.settings', icon: 'gear', route: '/settings' },
];
