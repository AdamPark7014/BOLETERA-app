import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { CarteleraBoard } from '@/components/purchase/CarteleraBoard';
import { api } from '@/lib/api';
import type { EventHit } from '@/components/EventDiscoveryPanel';
import { buildHubMetadata } from '@/lib/seo';
import { fetchSiteContent } from '@/lib/site-content';
import { fetchTenantCurrent } from '@/lib/tenant';

const CATEGORY_LABEL: Record<string, string> = {
  MUSIC: 'Conciertos',
  SPORTS: 'Deportes',
  THEATER: 'Artes y teatro',
  COMEDY: 'Comedia',
  FESTIVAL: 'Festivales',
  CONFERENCE: 'Conferencia',
  WORKSHOP: 'Taller',
  FAMILY: 'Familiar',
  STANDUP: 'Stand-up',
  CINEMA: 'Cine',
  OTHER: 'Evento',
};

const ALLOWED = new Set(Object.keys(CATEGORY_LABEL));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<Metadata> {
  const { key: raw } = await params;
  const key = raw.toUpperCase();
  const label = CATEGORY_LABEL[key] ?? key;
  const tenant = await fetchTenantCurrent();
  return buildHubMetadata({
    title: label,
    description: `${label} en cartelera en ${tenant.name}. Compra boletos oficiales con pago Banorte.`,
    path: `/categoria/${key}`,
  });
}

export default async function CategoriaPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key: raw } = await params;
  const key = raw.toUpperCase();
  if (!ALLOWED.has(key)) notFound();

  let events: EventHit[] = [];
  let failed = false;
  try {
    events = await api<EventHit[]>(
      `/discovery/events?category=${encodeURIComponent(key)}&limit=60`,
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
          presetCategory={key}
        />
      </main>
    </>
  );
}
