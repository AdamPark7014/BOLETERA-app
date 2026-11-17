import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { EventGrid } from '@/components/home/EventGrid';
import homeStyles from '@/components/home/home.module.scss';
import { api } from '@/lib/api';
import type { EventHit } from '@/components/EventDiscoveryPanel';
import { buildHubMetadata } from '@/lib/seo';
import { buildItemListJsonLd } from '@/lib/seo/item-list-jsonld';
import { getSiteOrigin } from '@/lib/site-url';
import { fetchTenantCurrent } from '@/lib/tenant';

export const revalidate = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city: raw } = await params;
  const city = decodeURIComponent(raw);
  const tenant = await fetchTenantCurrent();
  return buildHubMetadata({
    title: `Eventos en ${city}`,
    description: `Cartelera en ${city} en ${tenant.name}. Compra boletos oficiales.`,
    path: `/ciudades/${encodeURIComponent(city)}`,
  });
}

export default async function CiudadPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: raw } = await params;
  const city = decodeURIComponent(raw);
  let events: EventHit[] = [];
  let failed = false;
  try {
    events = await api<EventHit[]>(`/discovery/events?city=${encodeURIComponent(city)}&limit=60`);
  } catch {
    failed = true;
  }
  // Una ciudad que no existe en la cartelera es un 404, no una lista vacía.
  if (!failed && events.length === 0) {
    const facets = await api<{ cities?: { name: string }[] }>('/discovery/facets').catch(
      () => null
    );
    const known = facets?.cities?.some(
      (c) => c.name.toLocaleLowerCase('es-MX') === city.toLocaleLowerCase('es-MX')
    );
    if (facets && !known) notFound();
  }

  const [tenant, origin] = await Promise.all([fetchTenantCurrent(), getSiteOrigin()]);
  const jsonLd = buildItemListJsonLd({
    origin,
    name: `Eventos en ${city}`,
    description: `Cartelera en ${city} en ${tenant.name}.`,
    path: `/ciudades/${encodeURIComponent(city)}`,
    events: events.map((e) => ({
      slug: e.slug,
      title: e.title,
      startsAt: e.startsAt,
      image: e.image,
    })),
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={homeStyles.wrap}>
        <EventGrid
          events={events}
          failed={failed}
          title={city}
          headingLevel={1}
          emptyText="Pronto habrá funciones aquí."
        />
      </main>
    </>
  );
}
