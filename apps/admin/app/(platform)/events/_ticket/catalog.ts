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
        { id: 'canales', label: 'Canales', href: `/events/${eventId}?seccion=canales` },
        { id: 'apartados', label: 'Apartados', href: `/events/${eventId}?seccion=apartados` },
      ]
    : [
        { id: 'lista', label: 'Lista', href: '/events' },
        { id: 'series', label: 'Series', href: '/events/series' },
      ];

  return [
    { id: 'evento', label: eventId ? 'Evento' : 'Eventos', items: eventItems },
    { id: 'sala', label: 'Sala', items: SALA },
    { id: 'dinero', label: 'Dinero', items: DINERO },
    { id: 'casa', label: 'Casa', items: CASA },
  ];
}

export function activeIndexId(pathname: string, section: string | null): string | null {
  const eventId = eventIdFromPath(pathname);
  if (eventId) return section ?? 'evento';
  if (pathname.startsWith('/events/series')) return 'series';
  if (pathname === '/events') return 'lista';
  if (pathname === '/dinero/comisiones') return 'comisiones';
  if (pathname === '/dinero/cargos') return 'cargos';
  if (pathname === '/dinero/iva') return 'iva';
  if (pathname === '/dinero/reembolsos') return 'reembolsos';
  if (pathname === '/access-control' || pathname === '/scanner') return 'puerta';
  if (pathname === '/staff') return 'equipo';
  return null;
}
