import type { IconName } from '@/components/shell/icons';
import { hasAnyCapability, type Capability } from '@/lib/permissions';

/**
 * Menú del backoffice, agrupado como la maqueta: siete secciones de la
 * organización y, con un evento abierto, las secciones de ese evento.
 * Ninguna ruta se quita: cada pantalla vive dentro de una sección y se abre
 * desde su submenú. Cada entrada declara la capacidad que la abre; una sección
 * sin entradas visibles para el rol no se pinta.
 */

export type IndexItem = {
  id: string;
  label: string;
  href: string;
  /** Basta con una de estas capacidades. Vacío = cualquier rol con acceso. */
  caps?: Capability[];
  /** Solo SUPER_ADMIN (herramientas de toda la plataforma). */
  superAdminOnly?: boolean;
};

export type IndexGroup = {
  id: string;
  label: string;
  items: IndexItem[];
};

export type IndexSection = {
  id: string;
  label: string;
  icon: IconName;
  items: IndexItem[];
};

export const SECTIONS: IndexSection[] = [
  {
    id: 'inicio',
    label: 'Inicio',
    icon: 'home',
    items: [
      { id: 'tablero', label: 'Tablero', href: '/dashboard', caps: ['dashboard.view'] },
      { id: 'analitica', label: 'Analítica', href: '/analytics', caps: ['analytics.view'] },
      { id: 'ia', label: 'Asistente e IA', href: '/ai', caps: ['analytics.view'] },
      { id: 'calendario', label: 'Calendario', href: '/calendar', caps: ['events.view'] },
    ],
  },
  {
    id: 'eventos',
    label: 'Eventos',
    icon: 'events',
    items: [
      { id: 'lista', label: 'Todos los eventos', href: '/events', caps: ['events.view'] },
      { id: 'nuevo', label: 'Crear evento', href: '/events/new', caps: ['events.manage'] },
      {
        id: 'series',
        label: 'Series y residencias',
        href: '/events/series',
        caps: ['events.view'],
      },
      { id: 'inventario', label: 'Inventario', href: '/inventory', caps: ['inventory.monitor'] },
      {
        id: 'reservaciones',
        label: 'Apartados y bloqueos',
        href: '/reservations',
        caps: ['inventory.operate'],
      },
      { id: 'precios', label: 'Precios', href: '/pricing', caps: ['events.view'] },
    ],
  },
  {
    id: 'recintos',
    label: 'Recintos y planos',
    icon: 'mapPin',
    items: [
      { id: 'recinto', label: 'Recintos', href: '/venues', caps: ['venues.view'] },
      { id: 'mapa', label: 'Planos de butacas', href: '/maps', caps: ['venues.editMap'] },
      {
        id: 'puerta',
        label: 'Acceso y puertas',
        href: '/access-control',
        caps: ['safety.view'],
      },
      { id: 'escaner', label: 'Escáner', href: '/scanner', caps: ['access.scan'] },
      { id: 'egress', label: 'Salida y aforo', href: '/reports/egress', caps: ['safety.view'] },
    ],
  },
  {
    id: 'ordenes',
    label: 'Órdenes y clientes',
    icon: 'orders',
    items: [
      { id: 'ordenes', label: 'Órdenes', href: '/orders', caps: ['orders.view'] },
      {
        id: 'por-reembolsar',
        label: 'Por reembolsar',
        href: '/orders/refunds',
        caps: ['orders.refund'],
      },
      { id: 'crm', label: 'Clientes', href: '/crm', caps: ['marketing.manage'] },
      { id: 'reventa', label: 'Reventa', href: '/resale', caps: ['orders.view'] },
      {
        id: 'reventa-pagos',
        label: 'Reventa · Pagos a vendedores',
        href: '/resale/payouts',
        caps: ['finance.view'],
      },
      { id: 'membresias', label: 'Membresías', href: '/memberships', caps: ['marketing.manage'] },
      { id: 'abonos', label: 'Abonos', href: '/season', caps: ['marketing.manage'] },
      { id: 'espera', label: 'Lista de espera', href: '/waitlist', caps: ['marketing.manage'] },
    ],
  },
  {
    id: 'finanzas',
    label: 'Finanzas',
    icon: 'payouts',
    items: [
      { id: 'liquidaciones', label: 'Liquidaciones', href: '/payouts', caps: ['finance.view'] },
      { id: 'reportes', label: 'Reportes', href: '/reports', caps: ['reports.view'] },
      {
        id: 'reembolsos',
        label: 'Reembolsos',
        href: '/dinero/reembolsos',
        caps: ['orders.refund'],
      },
      { id: 'comisiones', label: 'Comisiones', href: '/dinero/comisiones', caps: ['finance.view'] },
      {
        id: 'cargos',
        label: 'Cargos por servicio',
        href: '/dinero/cargos',
        caps: ['finance.view'],
      },
      { id: 'iva', label: 'IVA', href: '/dinero/iva', caps: ['finance.view'] },
      { id: 'facturacion', label: 'Facturación', href: '/billing/cfdi', caps: ['finance.view'] },
      { id: 'fraude', label: 'Fraude y riesgo', href: '/fraud', caps: ['risk.view'] },
      {
        id: 'pagos',
        label: 'Pasarela de pago',
        href: '/settings/payments',
        caps: ['settings.payments'],
      },
    ],
  },
  {
    id: 'mercadotecnia',
    label: 'Mercadotecnia',
    icon: 'campaigns',
    items: [
      {
        id: 'descuentos',
        label: 'Campañas y descuentos',
        href: '/campaigns',
        caps: ['marketing.manage'],
      },
      { id: 'canales', label: 'Canales de venta', href: '/channels', caps: ['marketing.manage'] },
      {
        id: 'patrocinios',
        label: 'Patrocinios',
        href: '/sponsorships',
        caps: ['marketing.manage'],
      },
      { id: 'partners', label: 'Socios comerciales', href: '/partners', caps: ['org.manage'] },
      {
        id: 'automatizaciones',
        label: 'Automatizaciones',
        href: '/automations',
        caps: ['marketing.manage'],
      },
      {
        id: 'contenido',
        label: 'Contenido del sitio',
        href: '/settings/content',
        caps: ['settings.branding'],
      },
    ],
  },
  {
    id: 'equipo',
    label: 'Equipo y permisos',
    icon: 'team',
    items: [
      { id: 'equipo', label: 'Equipo', href: '/staff', caps: ['org.manage'] },
      {
        id: 'organizacion',
        label: 'Organización',
        href: '/settings/organization',
        caps: ['org.manage'],
      },
      { id: 'marca', label: 'Marca', href: '/settings/branding', caps: ['settings.branding'] },
      { id: 'auditoria', label: 'Bitácora', href: '/audit', caps: ['audit.view'] },
      { id: 'integraciones', label: 'Integraciones', href: '/integrations', caps: ['org.manage'] },
      { id: 'api', label: 'Llaves de API', href: '/api-management', caps: ['org.manage'] },
      { id: 'plataforma', label: 'Plan y módulos', href: '/platform', caps: ['org.manage'] },
      { id: 'control', label: 'Control global', href: '/platform/control', superAdminOnly: true },
      { id: 'salud', label: 'Salud operativa', href: '/platform/health', superAdminOnly: true },
    ],
  },
];

export function canSeeItem(role: string | null | undefined, item: IndexItem): boolean {
  if (item.superAdminOnly) return role === 'SUPER_ADMIN';
  if (!item.caps || item.caps.length === 0) return true;
  return hasAnyCapability(role, item.caps);
}

/** Secciones de la organización con solo las entradas que el rol puede abrir. */
export function sectionsForRole(role: string | null | undefined): IndexSection[] {
  return SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canSeeItem(role, item)),
  })).filter((section) => section.items.length > 0);
}

export function eventIdFromPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 3 && parts[0] === 'events' && parts[2] === 'cancel') return parts[1] ?? null;
  if (parts.length !== 2 || parts[0] !== 'events') return null;
  if (parts[1] === 'new' || parts[1] === 'series') return null;
  return parts[1] ?? null;
}

/** Secciones del evento abierto. Las seis de la maqueta primero; el resto después. */
export function eventItems(eventId: string): { main: IndexItem[]; more: IndexItem[] } {
  const base = `/events/${eventId}`;
  return {
    main: [
      { id: 'evento', label: 'Resumen', href: `${base}?seccion=evento` },
      {
        id: 'apartados',
        label: 'Inventario',
        href: `${base}?seccion=apartados`,
        caps: ['inventory.monitor', 'inventory.operate'],
      },
      { id: 'zonas', label: 'Precios', href: `${base}?seccion=zonas` },
      { id: 'fases', label: 'Preventas y códigos', href: `${base}?seccion=fases` },
      {
        id: 'puerta-evento',
        label: 'Acceso y puertas',
        href: '/access-control',
        caps: ['safety.view'],
      },
      {
        id: 'liquidacion-evento',
        label: 'Liquidación',
        href: '/payouts',
        caps: ['finance.view'],
      },
    ],
    more: [
      { id: 'agenda', label: 'Agenda', href: `${base}?seccion=agenda` },
      { id: 'canales', label: 'Canales', href: `${base}?seccion=canales` },
      { id: 'cumplimiento', label: 'Publicación', href: `${base}?seccion=cumplimiento` },
      {
        id: 'cancelar',
        label: 'Cancelación',
        href: `${base}/cancel`,
        caps: ['events.manage'],
      },
    ],
  };
}

/** Compatibilidad: grupos planos (evento + secciones) para quien los pida. */
export function indexGroups(eventId: string | null, role?: string | null): IndexGroup[] {
  const groups: IndexGroup[] = sectionsForRole(role).map((section) => ({
    id: section.id,
    label: section.label,
    items: section.items,
  }));
  if (!eventId) return groups;
  const ev = eventItems(eventId);
  return [{ id: 'evento', label: 'Este evento', items: [...ev.main, ...ev.more] }, ...groups];
}

/** Ruta → entrada activa del menú. */
export function activeIndexId(pathname: string, section: string | null): string | null {
  const eventId = eventIdFromPath(pathname);
  if (eventId && pathname.endsWith('/cancel')) return 'cancelar';
  if (eventId) return section ?? 'evento';
  if (pathname === '/settings/content') return 'contenido';
  let best: { id: string; len: number } | null = null;
  for (const group of SECTIONS) {
    for (const item of group.items) {
      const href = item.href;
      if (pathname === href || pathname.startsWith(`${href}/`)) {
        if (!best || href.length > best.len) best = { id: item.id, len: href.length };
      }
    }
  }
  if (best) return best.id;
  const venueMap = pathname.split('/').filter(Boolean);
  if (
    venueMap.length === 3 &&
    venueMap[0] === 'venues' &&
    (venueMap[2] === 'map' || venueMap[2] === '3d')
  ) {
    return 'mapa';
  }
  return null;
}

/** Sección de la organización que contiene la ruta actual. */
export function activeSectionId(pathname: string): string | null {
  if (eventIdFromPath(pathname)) return 'eventos';
  const id = activeIndexId(pathname, null);
  if (!id) return null;
  return SECTIONS.find((section) => section.items.some((item) => item.id === id))?.id ?? null;
}
