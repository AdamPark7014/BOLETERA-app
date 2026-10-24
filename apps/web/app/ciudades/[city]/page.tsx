import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { CarteleraBoard } from '@/components/purchase/CarteleraBoard';
import { api } from '@/lib/api';
import type { EventHit } from '@/components/EventDiscoveryPanel';
import { buildHubMetadata } from '@/lib/seo';
import { fetchSiteContent } from '@/lib/site-content';
import { fetchTenantCurrent } from '@/lib/tenant';

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

export default async function CiudadPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city: raw } = await params;
  const city = decodeURIComponent(raw);
  let events: EventHit[] = [];
  let failed = false;
  try {
    events = await api<EventHit[]>(
      `/discovery/events?city=${encodeURIComponent(city)}&limit=60`,
    );
  } catch {
    failed = true;
  }

  const site = await fetchSiteContent();

  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1}>
        <CarteleraBoard
          initial={events}
          initialFailed={failed}
          headline={site.heroHeadline?.trim() || 'Cartelera'}
          subcopy={site.heroSubcopy?.trim() || undefined}
          presetCity={city}
        />
      </main>
    </>
  );
}
