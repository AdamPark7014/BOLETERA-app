import { Suspense } from 'react';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { EventGrid } from '@/components/home/EventGrid';
import type { CardEvent } from '@/components/home/EventCard';
import { HomeHero, HomeHeroSkeleton, MembershipBand } from '@/components/home/HomeSections';
import { HomeRails } from '@/components/home/HomeRails';
import styles from '@/components/home/home.module.scss';
import { api } from '@/lib/api';
import { availability } from '@/lib/event-display';
import { buildHubMetadata } from '@/lib/seo';
import { fetchTenantCurrent } from '@/lib/tenant';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await fetchTenantCurrent();
  return buildHubMetadata({
    title: `Cartelera oficial`,
    description: `Compra boletos oficiales en ${tenant.name}: conciertos, deportes, teatro y más. Precio final con cargos e IVA incluidos.`,
    path: '/',
    image: tenant.theme?.logoUrl || '/hero/01-festival.jpg',
  });
}

type HomeSearch = { q?: string; city?: string };

async function load<T>(path: string, fallback: T): Promise<{ ok: boolean; value: T }> {
  try {
    return { ok: true, value: await api<T>(path) };
  } catch {
    return { ok: false, value: fallback };
  }
}

/** Evento destacado: el próximo con boletos y con imagen; si no, el primero. */
function pickFeatured(events: CardEvent[]): CardEvent | null {
  const upcoming = events
    .filter((e) => new Date(e.startsAt).getTime() > Date.now() - 3_600_000)
    .filter((e) => !availability(e.offers).soldOut);
  return upcoming.find((e) => e.bannerImage || e.image) ?? upcoming[0] ?? events[0] ?? null;
}

async function HomeContent({ q, city }: HomeSearch) {
  const params = new URLSearchParams({ limit: '40' });
  if (q) params.set('q', q);
  if (city) params.set('city', city);
  const filtered = Boolean(q || city);

  const [all, found] = await Promise.all([
    load<CardEvent[]>('/discovery/events?limit=40', []),
    filtered ? load<CardEvent[]>(`/discovery/events?${params}`, []) : Promise.resolve(null),
  ]);

  const list = found ? found.value : all.value;
  const failed = found ? !found.ok : !all.ok;
  const featured = pickFeatured(all.value);

  if (filtered) {
    const title = q
      ? `Resultados para «${q}»${city ? ` en ${city}` : ''}`
      : `En cartelera en ${city}`;
    return (
      <>
        <HomeHero event={featured} />
        <div className={styles.wrap}>
          <EventGrid
            events={list}
            failed={failed}
            title={title}
            emptyText="Sin resultados. Prueba con otro artista o ciudad."
          />
          <MembershipBand />
        </div>
      </>
    );
  }

  return (
    <>
      <HomeHero event={featured} />
      <div className={styles.wrap}>
        <HomeRails events={list} failed={failed} />
        <MembershipBand />
      </div>
    </>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<HomeSearch> }) {
  const { q, city } = await searchParams;
  const query = q?.trim() || undefined;
  const place = city?.trim() || undefined;

  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={styles.home}>
        <Suspense fallback={<HomeHeroSkeleton />}>
          <HomeContent q={query} city={place} />
        </Suspense>
      </main>
    </>
  );
}
