import { Suspense } from "react";
import { resolveCuratedCards } from "@boletera/shared";
import { SiteHeader } from "@/components/SiteHeader";
import { HomeHeroRoot } from "@/components/HomeHeroRoot";
import { EventDiscoveryPanel, type EventHit } from "@/components/EventDiscoveryPanel";
import { DiscoverySkeleton } from "@/components/DiscoverySkeleton";
import { HomeModules } from "@/components/HomeModules";
import { api } from "@/lib/api";
import { fetchSiteContent } from "@/lib/site-content";
import styles from "./page.module.scss";

type Facets = {
  cities: { name: string; count: number }[];
  categories: { key: string; count: number }[];
};

type VenueHit = {
  id: string;
  slug: string;
  name: string;
  city: string;
  state?: string;
  image?: string | null;
  eventCount: number;
};

/*
 * Las tres consultas de descubrimiento eran tres `await` en fila: en 4G eso son
 * tres viajes encadenados antes de pintar nada. Ahora salen a la vez y el
 * bloque entero vive dentro de <Suspense>, así la cabecera se envía de
 * inmediato y el esqueleto ocupa el hueco mientras llegan los datos.
 */
async function DiscoveryBoard() {
  const [settled, siteContent] = await Promise.all([
    Promise.allSettled([
      api<EventHit[]>("/discovery/events?limit=40"),
      api<Facets>("/discovery/facets"),
      api<VenueHit[]>("/discovery/venues?limit=8"),
    ]),
    fetchSiteContent(),
  ]);
  const [eventsResult, facetsResult, venuesResult] = settled;

  const events = eventsResult.status === "fulfilled" ? eventsResult.value : [];
  const facets =
    facetsResult.status === "fulfilled"
      ? facetsResult.value
      : { cities: [], categories: [] };
  const venues = venuesResult.status === "fulfilled" ? venuesResult.value : [];

  const eventsFailed = eventsResult.status === "rejected";
  const allFailed =
    eventsFailed &&
    facetsResult.status === "rejected" &&
    venuesResult.status === "rejected";

  const trending = [...events]
    .sort((a, b) => Number(b.offerCount ?? 0) - Number(a.offerCount ?? 0))
    .slice(0, 8);

  const curatedCards = resolveCuratedCards(siteContent);

  return (
    <>
      <section id="cartelera" className={styles.board} aria-label="Cartelera">
        <EventDiscoveryPanel
          initial={events}
          initialFailed={eventsFailed}
          suppressFeaturedHero
          curatedCards={curatedCards}
        />
      </section>

      <HomeModules
        trending={trending.slice(0, 4)}
        cities={facets.cities.slice(0, 8)}
        venues={venues.slice(0, 4)}
        failed={allFailed}
        siteContent={siteContent}
      />
    </>
  );
}

export default function Home() {
  return (
    <>
      <SiteHeader theme="dark" />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        <HomeHeroRoot />
        <Suspense fallback={<DiscoverySkeleton />}>
          <DiscoveryBoard />
        </Suspense>
      </main>
    </>
  );
}
