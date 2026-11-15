import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { EventGrid } from '@/components/home/EventGrid';
import homeStyles from '@/components/home/home.module.scss';
import { api } from '@/lib/api';
import type { EventHit } from '@/components/EventDiscoveryPanel';
import { buildHubMetadata } from '@/lib/seo';
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

export default async function CategoriaPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: raw } = await params;
  const key = raw.toUpperCase();
  if (!ALLOWED.has(key)) notFound();

  let events: EventHit[] = [];
  let failed = false;
  try {
    events = await api<EventHit[]>(
      `/discovery/events?category=${encodeURIComponent(key)}&limit=60`
    );
  } catch {
    failed = true;
  }

  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={homeStyles.wrap}>
        <EventGrid
          events={events}
          failed={failed}
          kicker={'★ Categoría ★'}
          title={CATEGORY_LABEL[key] ?? 'Cartelera'}
          headingLevel={1}
          emptyText="No hay funciones publicadas aquí por ahora. Revisa la cartelera completa."
        />
      </main>
    </>
  );
}
