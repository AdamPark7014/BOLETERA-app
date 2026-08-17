export type BreadcrumbCrumb = {
  label: string;
  href?: string;
};

/** Human labels for known path segments. Technical IDs are never shown. */
const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Inicio',
  events: 'Eventos',
  new: 'Nuevo',
  series: 'Series',
  calendar: 'Calendario',
  orders: 'Órdenes',
  inventory: 'Inventario',
  reservations: 'Reservaciones',
  maps: 'Creador de mapas',
  channels: 'Canales',
  campaigns: 'Campañas',
  pricing: 'Precios',
  crm: 'CRM',
  memberships: 'Membresías',
  sponsorships: 'Patrocinios',
  resale: 'Reventa',
  analytics: 'Analítica',
  ai: 'IA',
  reports: 'Reportes',
  egress: 'Egress',
  payouts: 'Liquidaciones',
  fraud: 'Antifraude',
  scanner: 'Escáner',
  'access-control': 'Control de acceso',
  staff: 'Personal',
  settings: 'Configuración',
  branding: 'Marca',
  payments: 'Pagos Banorte',
  organization: 'Equipo',
  platform: 'Capacidades',
  waitlist: 'Lista de espera',
  partners: 'Partners',
  billing: 'Facturación',
  cfdi: 'CFDI',
  season: 'Abonos',
  automations: 'Automatizaciones',
  integrations: 'Integraciones',
  'api-management': 'Gestión de API',
  audit: 'Auditoría',
  venues: 'Venues',
  '3d': 'Estudio 3D',
  map: 'Vista planta',
};

const PARENT_DETAIL_LABEL: Record<string, string> = {
  events: 'Detalle del evento',
  orders: 'Detalle de la orden',
  venues: 'Venue',
  campaigns: 'Detalle de campaña',
  partners: 'Detalle de partner',
};

function isTechnicalId(segment: string): boolean {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
    return true;
  }
  if (/^c[a-z0-9]{20,}$/i.test(segment)) return true;
  if (/^[0-9]{6,}$/.test(segment)) return true;
  if (segment.length >= 20 && /^[a-z0-9_-]+$/i.test(segment) && !SEGMENT_LABELS[segment]) {
    return true;
  }
  return false;
}

export type VenueNameLookup = ReadonlyMap<string, string>;

/**
 * Builds readable breadcrumbs from the current pathname.
 * Skips raw identifiers; resolves venue names when available.
 */
export function buildBreadcrumbs(
  pathname: string,
  venueNames?: VenueNameLookup,
): BreadcrumbCrumb[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return [{ label: 'Inicio', href: '/dashboard' }];
  }

  const crumbs: BreadcrumbCrumb[] = [{ label: 'Admin', href: '/dashboard' }];
  let acc = '';

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]!;
    acc += `/${segment}`;
    const isLast = i === segments.length - 1;
    const parent = i > 0 ? segments[i - 1]! : null;

    if (isTechnicalId(segment)) {
      let label = 'Detalle';
      if (parent === 'venues' && venueNames?.has(segment)) {
        label = venueNames.get(segment)!;
      } else if (parent && PARENT_DETAIL_LABEL[parent]) {
        label = PARENT_DETAIL_LABEL[parent]!;
      }
      crumbs.push({
        label,
        href: isLast ? undefined : acc,
      });
      continue;
    }

    const label =
      SEGMENT_LABELS[segment] ??
      segment
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');

    crumbs.push({
      label,
      href: isLast ? undefined : acc,
    });
  }

  return crumbs;
}
