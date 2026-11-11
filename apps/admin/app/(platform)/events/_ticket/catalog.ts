export type IndexItem = {
  id: string;
  label: string;
  href: string;
};

export type IndexGroup = {
  id: string;
  label: string;
  items: IndexItem[];
};

const SALA: IndexItem[] = [
  { id: 'recinto', label: 'Recinto', href: '/venues' },
  { id: 'mapa', label: 'Mapa', href: '/maps' },
  { id: 'puerta', label: 'Puerta', href: '/access-control' },
];

const DINERO: IndexItem[] = [
  { id: 'comisiones', label: 'Comisiones', href: '/dinero/comisiones' },
  { id: 'cargos', label: 'Cargos', href: '/dinero/cargos' },
  { id: 'iva', label: 'IVA', href: '/dinero/iva' },
  { id: 'descuentos', label: 'Descuentos', href: '/campaigns' },
  { id: 'reembolsos', label: 'Reembolsos', href: '/dinero/reembolsos' },
  { id: 'liquidaciones', label: 'Liquidaciones', href: '/payouts' },
  { id: 'facturacion', label: 'Facturación', href: '/billing/cfdi' },
  { id: 'pagos', label: 'Pagos', href: '/settings/payments' },
];

const VENTA: IndexItem[] = [
  { id: 'ordenes', label: 'Órdenes', href: '/orders' },
  { id: 'por-reembolsar', label: 'Por reembolsar', href: '/orders/refunds' },
  { id: 'inventario', label: 'Inventario', href: '/inventory' },
  { id: 'reservaciones', label: 'Reservaciones', href: '/reservations' },
  { id: 'precios', label: 'Precios', href: '/pricing' },
  { id: 'canales', label: 'Canales', href: '/channels' },
  { id: 'calendario', label: 'Calendario', href: '/calendar' },
  { id: 'reventa', label: 'Reventa', href: '/resale' },
  { id: 'membresias', label: 'Membresías', href: '/memberships' },
  { id: 'patrocinios', label: 'Patrocinios', href: '/sponsorships' },
];

const LECTURA: IndexItem[] = [
  { id: 'tablero', label: 'Tablero', href: '/dashboard' },
  { id: 'analitica', label: 'Analítica', href: '/analytics' },
  { id: 'auditoria', label: 'Auditoría', href: '/audit' },
  { id: 'crm', label: 'CRM', href: '/crm' },
];

const SISTEMA: IndexItem[] = [
  { id: 'integraciones', label: 'Integraciones', href: '/integrations' },
  { id: 'api', label: 'API', href: '/api-management' },
  { id: 'automatizaciones', label: 'Automatizaciones', href: '/automations' },
  { id: 'ia', label: 'IA', href: '/ai' },
  { id: 'control', label: 'Control', href: '/platform/control' },
  { id: 'salud', label: 'Salud', href: '/platform/health' },
];

/** Ruta exacta → oficio del índice, para las secciones sin subrutas propias. */
const SIMPLE_ACTIVE: Record<string, string> = {
  '/inventory': 'inventario',
  '/reservations': 'reservaciones',
  '/pricing': 'precios',
  '/channels': 'canales',
  '/calendar': 'calendario',
  '/resale': 'reventa',
  '/memberships': 'membresias',
  '/sponsorships': 'patrocinios',
  '/dashboard': 'tablero',
  '/analytics': 'analitica',
  '/audit': 'auditoria',
  '/crm': 'crm',
  '/integrations': 'integraciones',
  '/api-management': 'api',
  '/automations': 'automatizaciones',
  '/ai': 'ia',
  '/platform/control': 'control',
  '/platform/health': 'salud',
};

const CASA: IndexItem[] = [
  { id: 'reportes', label: 'Reportes', href: '/reports' },
  { id: 'fraude', label: 'Fraude', href: '/fraud' },
  { id: 'equipo', label: 'Equipo', href: '/staff' },
  { id: 'organizacion', label: 'Organización', href: '/settings/organization' },
  { id: 'marca', label: 'Marca', href: '/settings/branding' },
  { id: 'partners', label: 'Partners', href: '/partners' },
  { id: 'abonos', label: 'Abonos', href: '/season' },
  { id: 'espera', label: 'Espera', href: '/waitlist' },
  { id: 'plataforma', label: 'Plataforma', href: '/platform' },
];

export function eventIdFromPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 3 && parts[0] === 'events' && parts[2] === 'cancel') return parts[1] ?? null;
  if (parts.length !== 2 || parts[0] !== 'events') return null;
  if (parts[1] === 'new' || parts[1] === 'series') return null;
  return parts[1] ?? null;
}

export function indexGroups(eventId: string | null): IndexGroup[] {
  const eventItems: IndexItem[] = eventId
    ? [
        { id: 'evento', label: 'Evento', href: `/events/${eventId}?seccion=evento` },
        { id: 'agenda', label: 'Agenda', href: `/events/${eventId}?seccion=agenda` },
        { id: 'zonas', label: 'Zonas y precios', href: `/events/${eventId}?seccion=zonas` },
        { id: 'fases', label: 'Fases', href: `/events/${eventId}?seccion=fases` },
        { id: 'canales', label: 'Canales', href: `/events/${eventId}?seccion=canales` },
        { id: 'apartados', label: 'Apartados', href: `/events/${eventId}?seccion=apartados` },
        {
          id: 'cumplimiento',
          label: 'Cumplimiento',
          href: `/events/${eventId}?seccion=cumplimiento`,
        },
        { id: 'cancelar', label: 'Cancelación', href: `/events/${eventId}/cancel` },
      ]
    : [
        { id: 'lista', label: 'Lista', href: '/events' },
        { id: 'series', label: 'Series', href: '/events/series' },
      ];

  return [
    { id: 'evento', label: eventId ? 'Evento' : 'Eventos', items: eventItems },
    { id: 'venta', label: 'Venta', items: VENTA },
    { id: 'sala', label: 'Sala', items: SALA },
    { id: 'dinero', label: 'Dinero', items: DINERO },
    { id: 'lectura', label: 'Lectura', items: LECTURA },
    { id: 'casa', label: 'Casa', items: CASA },
    { id: 'sistema', label: 'Sistema', items: SISTEMA },
  ];
}

export function activeIndexId(pathname: string, section: string | null): string | null {
  const eventId = eventIdFromPath(pathname);
  if (eventId && pathname.endsWith('/cancel')) return 'cancelar';
  if (eventId) return section ?? 'evento';
  const simple = SIMPLE_ACTIVE[pathname];
  if (simple) return simple;
  if (pathname === '/orders/refunds') return 'por-reembolsar';
  if (pathname === '/orders' || pathname.startsWith('/orders/')) return 'ordenes';
  if (pathname.startsWith('/events/series')) return 'series';
  if (pathname === '/events') return 'lista';
  if (pathname === '/dinero/comisiones') return 'comisiones';
  if (pathname === '/dinero/cargos') return 'cargos';
  if (pathname === '/dinero/iva') return 'iva';
  if (pathname === '/dinero/reembolsos') return 'reembolsos';
  if (pathname === '/access-control' || pathname === '/scanner') return 'puerta';
  if (pathname === '/staff') return 'equipo';
  if (pathname === '/payouts') return 'liquidaciones';
  if (pathname === '/billing/cfdi' || pathname.startsWith('/billing/')) return 'facturacion';
  if (pathname === '/reports' || pathname.startsWith('/reports/')) return 'reportes';
  if (pathname === '/fraud') return 'fraude';
  if (pathname === '/campaigns') return 'descuentos';
  if (pathname === '/venues') return 'recinto';
  if (pathname === '/maps') return 'mapa';
  const venueMap = pathname.split('/').filter(Boolean);
  if (
    venueMap.length === 3 &&
    venueMap[0] === 'venues' &&
    (venueMap[2] === 'map' || venueMap[2] === '3d')
  ) {
    return 'mapa';
  }
  if (pathname === '/settings/organization') return 'organizacion';
  if (pathname === '/settings/branding' || pathname === '/settings/content') return 'marca';
  if (pathname === '/partners') return 'partners';
  if (pathname === '/season') return 'abonos';
  if (pathname === '/waitlist') return 'espera';
  if (pathname === '/settings/payments') return 'pagos';
  if (pathname === '/platform') return 'plataforma';
  return null;
}
