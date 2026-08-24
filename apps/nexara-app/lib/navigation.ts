import { UserRole, type UserRoleValue } from '@boletera/shared';

export type TabName =
  | 'index'
  | 'events'
  | 'tickets'
  | 'taquilla'
  | 'scan'
  | 'sales'
  | 'orders'
  | 'platform'
  | 'profile';

export type TabConfig = {
  name: TabName;
  title: string;
  /** @expo/vector-icons Ionicons name */
  icon: string;
};

const ICON = {
  home: 'home-outline',
  calendar: 'calendar-outline',
  ticket: 'ticket-outline',
  cart: 'cart-outline',
  scan: 'scan-outline',
  stats: 'stats-chart-outline',
  receipt: 'receipt-outline',
  globe: 'globe-outline',
  person: 'person-outline',
} as const;

const TAB: Record<TabName, TabConfig> = {
  index: { name: 'index', title: 'Inicio', icon: ICON.home },
  events: { name: 'events', title: 'Eventos', icon: ICON.calendar },
  tickets: { name: 'tickets', title: 'Boletos', icon: ICON.ticket },
  taquilla: { name: 'taquilla', title: 'Taquilla', icon: ICON.cart },
  scan: { name: 'scan', title: 'Escanear', icon: ICON.scan },
  sales: { name: 'sales', title: 'Ventas', icon: ICON.stats },
  orders: { name: 'orders', title: 'Pedidos', icon: ICON.receipt },
  platform: { name: 'platform', title: 'Plataforma', icon: ICON.globe },
  profile: { name: 'profile', title: 'Perfil', icon: ICON.person },
};

const ALL_TAB_NAMES: TabName[] = [
  'index',
  'events',
  'tickets',
  'taquilla',
  'scan',
  'sales',
  'orders',
  'platform',
  'profile',
];

const TAQUILLA_ROLES = new Set<UserRoleValue>([
  UserRole.TAQUILLA,
  UserRole.TAQUILLA_SUPERVISOR,
  UserRole.TAQUILLA_ADMIN,
]);

const STAFF_ADMIN_ROLES = new Set<UserRoleValue>([
  UserRole.ADMIN,
  UserRole.VENUE_MANAGER,
]);

export function tabsForRole(role: string): TabConfig[] {
  const r = role as UserRoleValue;

  if (r === UserRole.PROMOTER) {
    return [TAB.index, TAB.sales, TAB.events, TAB.orders, TAB.profile];
  }
  if (TAQUILLA_ROLES.has(r)) {
    return [TAB.index, TAB.taquilla, TAB.events, TAB.profile];
  }
  if (r === UserRole.SCANNER) {
    return [TAB.index, TAB.scan, TAB.events, TAB.profile];
  }
  if (STAFF_ADMIN_ROLES.has(r)) {
    return [TAB.index, TAB.events, TAB.orders, TAB.profile];
  }
  if (r === UserRole.SUPER_ADMIN) {
    return [TAB.index, TAB.platform, TAB.events, TAB.orders, TAB.profile];
  }

  // Customer / fallback
  return [TAB.index, TAB.events, TAB.tickets, TAB.profile];
}

export function isTabVisible(role: string, tab: TabName): boolean {
  return tabsForRole(role).some((t) => t.name === tab);
}

export function allTabNames(): TabName[] {
  return ALL_TAB_NAMES;
}

export function roleLabel(role: string): string {
  const labels: Partial<Record<UserRoleValue, string>> = {
    [UserRole.PROMOTER]: 'Promotor',
    [UserRole.TAQUILLA]: 'Taquilla',
    [UserRole.TAQUILLA_SUPERVISOR]: 'Supervisor taquilla',
    [UserRole.TAQUILLA_ADMIN]: 'Admin taquilla',
    [UserRole.SCANNER]: 'Acceso',
    [UserRole.ADMIN]: 'Administrador',
    [UserRole.SUPER_ADMIN]: 'Super admin',
    [UserRole.VENUE_MANAGER]: 'Venue manager',
    [UserRole.CUSTOMER]: 'Cliente',
  };
  return labels[role as UserRoleValue] ?? role;
}
