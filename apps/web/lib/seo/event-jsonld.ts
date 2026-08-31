import { absUrlWithOrigin } from '../site-url';

export type EventJsonLdOffer = {
  id: string;
  zone: string;
  name?: string;
  basePrice: string | number;
  remainingQuantity?: number;
  isAvailable?: boolean;
};

export type EventJsonLdInput = {
  origin: string;
  slug: string;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt?: string | null;
  currency?: string;
  image?: string | null;
  bannerImage?: string | null;
  category?: string | null;
  venue?: {
    name: string;
    city: string;
    address?: string | null;
    state?: string | null;
    postalCode?: string | null;
  } | null;
  organization?: { name: string } | null;
  tenantName: string;
  offers: EventJsonLdOffer[];
  /** Local hero fallback when DB has no banner/image. */
  imageFallbackPath: string;
};

function offerAvailability(o: EventJsonLdOffer): string {
  const remaining = o.remainingQuantity;
  if (o.isAvailable === false || (typeof remaining === 'number' && remaining <= 0)) {
    return 'https://schema.org/SoldOut';
  }
  return 'https://schema.org/InStock';
}

/** Google Event rich-result JSON-LD: one Offer per tier + absolute image. */
export function buildEventJsonLd(input: EventJsonLdInput) {
  const eventUrl = `${input.origin.replace(/\/$/, '')}/events/${input.slug}`;
  const when = new Date(input.startsAt);
  const end = input.endsAt
    ? new Date(input.endsAt)
    : new Date(when.getTime() + 3 * 60 * 60 * 1000);
  const currency = input.currency || 'MXN';
  const image =
    absUrlWithOrigin(input.origin, input.bannerImage || input.image) ||
    absUrlWithOrigin(input.origin, input.imageFallbackPath);

  const offers = input.offers.map((o) => {
    const price = Number(o.basePrice);
    return {
      '@type': 'Offer',
      name: o.name || o.zone,
      price: Number.isFinite(price) ? price : 0,
      priceCurrency: currency,
      availability: offerAvailability(o),
      url: eventUrl,
      validFrom: new Date().toISOString(),
    };
  });

  const crumbs: { '@type': string; position: number; name: string; item: string }[] = [
    { '@type': 'ListItem', position: 1, name: 'Cartelera', item: `${input.origin}/` },
  ];
  if (input.category) {
    crumbs.push({
      '@type': 'ListItem',
      position: 2,
      name: input.category,
      item: `${input.origin}/categoria/${input.category}`,
    });
    crumbs.push({
      '@type': 'ListItem',
      position: 3,
      name: input.title,
      item: eventUrl,
    });
  } else {
    crumbs.push({
      '@type': 'ListItem',
      position: 2,
      name: input.title,
      item: eventUrl,
    });
  }

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: input.title,
      description: input.description || undefined,
      startDate: input.startsAt,
      endDate: end.toISOString(),
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      image: image ? [image] : undefined,
      url: eventUrl,
      location: input.venue
        ? {
            '@type': 'Place',
            name: input.venue.name,
            address: {
              '@type': 'PostalAddress',
              addressLocality: input.venue.city,
              streetAddress: input.venue.address || undefined,
              addressRegion: input.venue.state || undefined,
              postalCode: input.venue.postalCode || undefined,
              addressCountry: 'MX',
            },
          }
        : undefined,
      offers: offers.length ? offers : undefined,
      organizer: input.organization?.name
        ? { '@type': 'Organization', name: input.organization.name }
        : { '@type': 'Organization', name: input.tenantName },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: crumbs,
    },
  ];
}

export function buildOrganizationWebsiteJsonLd(opts: {
  origin: string;
  name: string;
  logoUrl?: string | null;
}) {
  const origin = opts.origin.replace(/\/$/, '');
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: opts.name,
      url: origin,
      logo: opts.logoUrl || undefined,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: opts.name,
      url: origin,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${origin}/?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
  ];
}

/** Same local hero picker as EventPosterArt (keep paths in sync). */
export function localPosterFallback(category?: string | null, seed?: string): string {
  const s = seed ?? '';
  switch (category) {
    case 'FESTIVAL':
      return '/hero/01-festival.jpg';
    case 'SPORTS':
      return '/hero/04-experience.jpg';
    case 'THEATER':
    case 'COMEDY':
      return '/hero/05-indie.jpg';
    case 'EXPERIENCE':
      return '/hero/04-experience.jpg';
    default:
      if (/electro|edm|dj/i.test(s)) return '/hero/03-electro.jpg';
      if (/indie|jazz|ballet/i.test(s)) return '/hero/05-indie.jpg';
      if (/fest|open.?air/i.test(s)) return '/hero/01-festival.jpg';
      return '/hero/02-concert.jpg';
  }
}
