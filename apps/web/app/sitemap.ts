import type { MetadataRoute } from 'next';
import { api } from '@/lib/api';
import { getSiteOrigin } from '@/lib/site-url';

export const revalidate = 3600;

type EventHit = { slug: string; startsAt?: string };
type VenueHit = { slug: string };
type Facets = { cities: { name: string }[]; categories: { key: string }[] };

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await getSiteOrigin();
  const now = new Date();

  const staticPaths: MetadataRoute.Sitemap = [
    { url: `${origin}/`, lastModified: now, changeFrequency: 'hourly', priority: 1 },
    { url: `${origin}/ciudades`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${origin}/venues`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${origin}/ayuda`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${origin}/terminos`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${origin}/privacidad`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
  ];

  let events: EventHit[] = [];
  let venues: VenueHit[] = [];
  let facets: Facets = { cities: [], categories: [] };

  try {
    const [e, v, f] = await Promise.all([
      api<EventHit[]>('/discovery/events?limit=100'),
      api<VenueHit[]>('/discovery/venues?limit=40'),
      api<Facets>('/discovery/facets'),
    ]);
    events = Array.isArray(e) ? e : [];
    venues = Array.isArray(v) ? v : [];
    facets = f ?? facets;
  } catch {
    // Tenant API down: still publish hubs/legales.
  }

  const eventEntries: MetadataRoute.Sitemap = events
    .filter((ev) => ev.slug)
    .map((ev) => ({
      url: `${origin}/events/${ev.slug}`,
      lastModified: ev.startsAt ? new Date(ev.startsAt) : now,
      changeFrequency: 'daily',
      priority: 0.9,
    }));

  const venueEntries: MetadataRoute.Sitemap = venues
    .filter((v) => v.slug)
    .map((v) => ({
      url: `${origin}/venues/${v.slug}`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    }));

  const cityEntries: MetadataRoute.Sitemap = (facets.cities ?? []).map((c) => ({
    url: `${origin}/ciudades/${encodeURIComponent(c.name)}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  const categoryEntries: MetadataRoute.Sitemap = (facets.categories ?? []).map((c) => ({
    url: `${origin}/categoria/${c.key}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  return [
    ...staticPaths,
    ...eventEntries,
    ...venueEntries,
    ...cityEntries,
    ...categoryEntries,
  ];
}
