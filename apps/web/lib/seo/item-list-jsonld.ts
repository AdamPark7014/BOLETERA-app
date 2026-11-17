/** JSON-LD ItemList + WebPage para hubs de ciudad y categoría. */

export type EventListItem = {
  slug: string;
  title: string;
  startsAt: string;
  image?: string | null;
};

export function buildItemListJsonLd(opts: {
  origin: string;
  name: string;
  description: string;
  path: string;
  events: EventListItem[];
}) {
  const origin = opts.origin.replace(/\/$/, '');
  const url = `${origin}${opts.path.startsWith('/') ? opts.path : `/${opts.path}`}`;

  const itemListElement = opts.events.map((event, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    url: `${origin}/events/${encodeURIComponent(event.slug)}`,
    name: event.title,
    item: {
      '@type': 'Event',
      name: event.title,
      startDate: event.startsAt,
      url: `${origin}/events/${encodeURIComponent(event.slug)}`,
      image: event.image || undefined,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    },
  }));

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: opts.name,
      description: opts.description,
      url,
      inLanguage: 'es-MX',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: opts.name,
      description: opts.description,
      url,
      numberOfItems: opts.events.length,
      itemListElement,
    },
  ];
}
