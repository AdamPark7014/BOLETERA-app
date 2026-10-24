import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { AffiliateRefCapture } from '@/components/AffiliateRefCapture';
import { EventStage } from './EventStage';
import { api } from '@/lib/api';
import {
  buildEventJsonLd,
  localPosterFallback,
} from '@/lib/seo/event-jsonld';
import { absUrlWithOrigin, getSiteOrigin } from '@/lib/site-url';
import { fetchTenantCurrent } from '@/lib/tenant';

type EventDetail = {
  /** Precio final al comprador, cargos e IVA incluidos. */
  minPriceAllIn?: number;
  id: string;
  slug: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt?: string | null;
  category?: string | null;
  genre?: string | null;
  rating?: string | null;
  currency?: string;
  image?: string | null;
  bannerImage?: string | null;
  posterAspect?: string | null;
  metadata?: { posterAspect?: string } | null;
  allowResale?: boolean;
  transferAllowed?: boolean;
  refundable?: boolean;
  nonTransferable?: boolean;
  holdExpiration?: number;
  seatMap: { snapshotData: unknown } | null;
  offers: { id: string; zone: string; name?: string; basePrice: string; remainingQuantity?: number; isAvailable?: boolean }[];
  venue?: {
    name: string;
    city: string;
    state?: string | null;
    address?: string | null;
    postalCode?: string | null;
    phone?: string | null;
    website?: string | null;
  };
  organization?: { name: string };
};

/*
 * `generateMetadata` y el propio componente piden el mismo evento. Como
 * `api()` va con cache: 'no-store', Next no puede deduplicar por sí solo y
 * salían dos viajes al API por visita. `cache()` los colapsa en uno dentro de
 * la misma petición.
 */
const loadEvent = cache(async (slug: string) =>
  api<EventDetail>(`/discovery/events/${slug}`),
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const [event, origin, tenant] = await Promise.all([
      loadEvent(slug),
      getSiteOrigin(),
      fetchTenantCurrent(),
    ]);
    const when = new Date(event.startsAt);
    const dateLabel = when.toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const venue = [event.venue?.name, event.venue?.city].filter(Boolean).join(', ');
    const title = `${event.title} | Boletos oficiales`;
    const description =
      event.description?.slice(0, 155) ||
      `Compra boletos oficiales para ${event.title}${venue ? ` en ${venue}` : ''} · ${dateLabel}. Pago Banorte.`;
    const fallback = localPosterFallback(event.category, event.slug);
    const image =
      absUrlWithOrigin(origin, event.bannerImage || event.image) ||
      absUrlWithOrigin(origin, fallback);
    const url = `${origin}/events/${slug}`;
    return {
      title,
      description,
      openGraph: {
        title,
        description,
        url,
        type: 'website',
        locale: 'es_MX',
        siteName: tenant.name,
        images: image ? [{ url: image }] : undefined,
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: image ? [image] : undefined,
      },
      alternates: { canonical: url },
    };
  } catch {
    const tenant = await fetchTenantCurrent();
    return { title: `Evento | ${tenant.name}` };
  }
}

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ zone?: string; ref?: string }>;
}) {
  const { slug } = await params;
  const { zone, ref } = await searchParams;

  let event: EventDetail;
  try {
    event = await loadEvent(slug);
  } catch {
    notFound();
  }
  const [tenant, origin] = await Promise.all([fetchTenantCurrent(), getSiteOrigin()]);
  const brandName = tenant.name;
  const prices = event.offers.map((o) => Number(o.basePrice)).filter((n) => !Number.isNaN(n));
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const jsonLd = buildEventJsonLd({
    origin,
    slug,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    currency: event.currency,
    image: event.image,
    bannerImage: event.bannerImage,
    category: event.category,
    venue: event.venue,
    organization: event.organization,
    tenantName: brandName,
    offers: event.offers,
    imageFallbackPath: localPosterFallback(event.category, event.slug),
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteHeader />
      <AffiliateRefCapture refCode={ref} eventId={event.id} />
      <main id="contenido" tabIndex={-1}>
        <EventStage
          eventId={event.id}
          slug={event.slug}
          title={event.title}
          description={event.description}
          startsAt={event.startsAt}
          genre={event.genre}
          rating={event.rating}
          image={event.image}
          bannerImage={event.bannerImage}
          category={event.category}
          allowResale={event.allowResale}
          transferAllowed={event.transferAllowed}
          refundable={event.refundable}
          nonTransferable={event.nonTransferable}
          holdExpiration={event.holdExpiration}
          offers={event.offers}
          venueName={event.venue?.name}
          venueCity={event.venue?.city}
          venueAddress={event.venue?.address}
          minPrice={minPrice}
          minPriceAllIn={event.minPriceAllIn}
          currency={event.currency || 'MXN'}
          focusZone={zone ?? null}
          mapData={event.seatMap?.snapshotData}
        />
      </main>
    </>
  );
}
