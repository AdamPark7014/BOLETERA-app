import type { IconName } from './icons';

export type NavItemId = string;

export type NavItemDef = {
  id: NavItemId;
  href: string;
  label: string;
  icon: IconName;
  keywords?: readonly string[];
  /** Matching for nested routes. Defaults to href prefix with special cases. */
  match?: 'exact' | 'prefix' | 'events' | 'reports';
};

export type NavGroupDef = {
  id: string;
  label: string;
  items: readonly NavItemDef[];
  /** Venues subsection rendered after items when true. */
  showVenues?: boolean;
  defaultCollapsed?: boolean;
};

/**
 * Navigation catalog. Modules (CRM, pricing, memberships, sponsorships,
 * staff, automations, integrations, API, AI, inventory, reservations,
 * access-control) live as groups/items without flattening the tree.
 */
export const NAV_GROUPS: readonly NavGroupDef[] = [
  {
    id: 'operation',
    label: 'Operación',
    items: [
      {
        id: 'dashboard',
        href: '/dashboard',
        label: 'Inicio',
        icon: 'home',
        keywords: ['dashboard', 'panel', 'resumen'],
        match: 'exact',
      },
      {
        id: 'events',
        href: '/events',
        label: 'Eventos',
        icon: 'events',
        keywords: ['función', 'show', 'concierto'],
        match: 'events',
      },
      {
        id: 'calendar',
        href: '/calendar',
        label: 'Calendario',
        icon: 'calendar',
        keywords: ['agenda', 'fechas'],
      },
      {
        id: 'series',
        href: '/events/series',
        label: 'Series',
        icon: 'series',
        keywords: ['temporada', 'ciclo'],
      },
      {
        id: 'orders',
        href: '/orders',
        label: 'Órdenes',
        icon: 'orders',
        keywords: ['pedidos', 'compras', 'tickets'],
      },
      {
        id: 'inventory',
        href: '/inventory',
        label: 'Inventario',
        icon: 'series',
        keywords: ['stock', 'boletos', 'disponibilidad'],
      },
      {
        id: 'reservations',
        href: '/reservations',
        label: 'Reservaciones',
        icon: 'waitlist',
        keywords: ['holds', 'apartados', 'reserva'],
      },
    ],
  },
  {
    id: 'venues',
    label: 'Venues y mapas',
    showVenues: true,
    items: [
      {
        id: 'maps',
        href: '/maps',
        label: 'Creador de mapas',
        icon: 'mapPin',
        keywords: ['venue', 'asientos', 'plano', 'mapa'],
      },
    ],
  },
  {
    id: 'sales',
    label: 'Ventas',
    items: [
      {
        id: 'channels',
        href: '/channels',
        label: 'Canales',
        icon: 'channels',
        keywords: ['taquilla', 'web', 'distribución'],
      },
      {
        id: 'campaigns',
        href: '/campaigns',
        label: 'Campañas',
        icon: 'campaigns',
        keywords: ['promoción', 'marketing', 'cupón'],
      },
      {
        id: 'pricing',
        href: '/pricing',
        label: 'Precios',
        icon: 'billing',
        keywords: ['tarifas', 'dynamic pricing', 'precios'],
      },
      {
        id: 'crm',
        href: '/crm',
        label: 'CRM',
        icon: 'user',
        keywords: ['clientes', 'audiencia', 'contacto'],
      },
      {
        id: 'memberships',
        href: '/memberships',
        label: 'Membresías',
        icon: 'season',
        keywords: ['socios', 'club', 'suscripción'],
      },
      {
        id: 'sponsorships',
        href: '/sponsorships',
        label: 'Patrocinios',
        icon: 'partners',
        keywords: ['sponsors', 'marcas', 'alianzas'],
      },
      {
        id: 'resale',
        href: '/resale',
        label: 'Reventa',
        icon: 'resale',
        keywords: ['secundario', 'marketplace'],
      },
    ],
  },
  {
    id: 'intelligence',
    label: 'Inteligencia',
    items: [
      {
        id: 'analytics',
        href: '/analytics',
        label: 'Analítica',
        icon: 'analytics',
        keywords: ['métricas', 'kpi', 'insights'],
      },
      {
        id: 'ai',
        href: '/ai',
        label: 'IA',
        icon: 'star',
        keywords: ['inteligencia artificial', 'forecast', 'recomendaciones'],
      },
      {
        id: 'reports',
        href: '/reports',
        label: 'Reportes',
        icon: 'reports',
        keywords: ['exportar', 'informe'],
        match: 'reports',
      },
      {
        id: 'egress',
        href: '/reports/egress',
        label: 'Egress',
        icon: 'egress',
        keywords: ['salida', 'flujo', 'aforo'],
      },
      {
        id: 'fraud',
        href: '/fraud',
        label: 'Antifraude',
        icon: 'fraud',
        keywords: ['riesgo', 'seguridad'],
      },
    ],
  },
  {
    id: 'finance',
    label: 'Finanzas',
    items: [
      {
        id: 'payouts',
        href: '/payouts',
        label: 'Liquidaciones',
        icon: 'payouts',
        keywords: ['pagos', 'settlement', 'dinero'],
      },
      {
        id: 'billing',
        href: '/billing/cfdi',
        label: 'Facturación',
        icon: 'billing',
        keywords: ['cfdi', 'factura', 'fiscal'],
      },
    ],
  },
  {
    id: 'access',
    label: 'Acceso',
    items: [
      {
        id: 'scanner',
        href: '/scanner',
        label: 'Escáner',
        icon: 'scanner',
        keywords: ['check-in', 'entrada', 'qr'],
      },
      {
        id: 'access-control',
        href: '/access-control',
        label: 'Control de acceso',
        icon: 'fraud',
        keywords: ['puertas', 'torniquetes', 'aforo'],
      },
      {
        id: 'staff',
        href: '/staff',
        label: 'Personal',
        icon: 'team',
        keywords: ['staff', 'operadores', 'crew'],
      },
    ],
  },
  {
    id: 'organization',
    label: 'Organización',
    items: [
      {
        id: 'platform',
        href: '/platform',
        label: 'Capacidades',
        icon: 'platform',
        keywords: ['módulos', 'features'],
      },
      {
        id: 'waitlist',
        href: '/waitlist',
        label: 'Lista de espera',
        icon: 'waitlist',
        keywords: ['cola', 'demanda'],
      },
      {
        id: 'partners',
        href: '/partners',
        label: 'Partners',
        icon: 'partners',
        keywords: ['aliados', 'promotores'],
      },
      {
        id: 'season',
        href: '/season',
        label: 'Abonos',
        icon: 'season',
        keywords: ['membresía', 'season pass'],
      },
      {
        id: 'automations',
        href: '/automations',
        label: 'Automatizaciones',
        icon: 'platform',
        keywords: ['workflows', 'reglas', 'triggers'],
      },
      {
        id: 'integrations',
        href: '/integrations',
        label: 'Integraciones',
        icon: 'channels',
        keywords: ['conectores', 'webhooks', 'apps'],
      },
      {
        id: 'api-management',
        href: '/api-management',
        label: 'Gestión de API',
        icon: 'external',
        keywords: ['api', 'keys', 'developers'],
      },
      {
        id: 'team',
        href: '/settings/organization',
        label: 'Equipo',
        icon: 'team',
        keywords: ['usuarios', 'roles', 'permisos'],
      },
      {
        id: 'audit',
        href: '/audit',
        label: 'Auditoría',
        icon: 'audit',
        keywords: ['logs', 'actividad', 'historial'],
      },
    ],
  },
  {
    id: 'settings',
    label: 'Configuración',
    defaultCollapsed: true,
    items: [
      {
        id: 'branding',
        href: '/settings/branding',
        label: 'Marca',
        icon: 'branding',
        keywords: ['branding', 'logo', 'colores'],
      },
      {
        id: 'payments',
        href: '/settings/payments',
        label: 'Pagos Banorte',
        icon: 'payments',
        keywords: ['pasarela', 'banorte', 'cobro'],
      },
    ],
  },
] as const;

export function flattenNavItems(): NavItemDef[] {
  return NAV_GROUPS.flatMap((group) => [...group.items]);
}

export function isNavItemActive(pathname: string, item: NavItemDef): boolean {
  const match = item.match ?? 'prefix';
  if (match === 'exact') return pathname === item.href;
  if (match === 'events') {
    if (pathname === '/events') return true;
    if (!pathname.startsWith('/events/')) return false;
    return !pathname.startsWith('/events/series');
  }
  if (match === 'reports') {
    if (pathname === '/reports') return true;
    if (!pathname.startsWith('/reports/')) return false;
    return !pathname.startsWith('/reports/egress');
  }
  if (pathname === item.href) return true;
  return pathname.startsWith(`${item.href}/`);
}

export function roleLabel(role: string | null | undefined): string {
  if (!role) return 'Usuario';
  switch (role.toUpperCase()) {
    case 'SUPER_ADMIN':
      return 'Super admin';
    case 'ADMIN':
      return 'Administrador';
    case 'OWNER':
      return 'Propietario';
    case 'MANAGER':
      return 'Gerente';
    case 'STAFF':
      return 'Staff';
    case 'SCANNER':
      return 'Escáner';
    default:
      return role;
  }
}
