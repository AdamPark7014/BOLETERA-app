import { Suspense } from "react";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import type { EventHit } from "@/components/EventDiscoveryPanel";
import { DiscoverySkeleton } from "@/components/DiscoverySkeleton";
import { CarteleraBoard } from "@/components/purchase/CarteleraBoard";
import { api } from "@/lib/api";
import { buildHubMetadata } from "@/lib/seo";
import { fetchSiteContent } from "@/lib/site-content";
import { fetchTenantCurrent } from "@/lib/tenant";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await fetchTenantCurrent();
  return buildHubMetadata({
    title: `Cartelera oficial`,
    description: `Compra boletos oficiales en ${tenant.name}: conciertos, deportes, teatro y más. Inventario real y pago Banorte.`,
    path: "/",
    image: tenant.theme?.logoUrl || "/hero/01-festival.jpg",
  });
}

async function DiscoveryBoard() {
  const [eventsResult, siteContent] = await Promise.all([
    api<EventHit[]>("/discovery/events?limit=40").then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const, value: [] as EventHit[] }),
    ),
    fetchSiteContent(),
  ]);
  const events = eventsResult.value;
  const eventsFailed = !eventsResult.ok;

  return (
    <CarteleraBoard
      initial={events}
      initialFailed={eventsFailed}
      headline={siteContent.heroHeadline?.trim() || "Cartelera"}
      subcopy={siteContent.heroSubcopy?.trim() || undefined}
    />
  );
}

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1}>
        <Suspense fallback={<DiscoverySkeleton />}>
          <DiscoveryBoard />
        </Suspense>
      </main>
    </>
  );
}
