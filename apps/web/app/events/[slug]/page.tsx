import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, CardFooter, CardHeader, Section } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { EventPosterArt } from '@/components/EventPosterArt';
import { WaitlistSignup } from '@/components/WaitlistSignup';
import { ZoneOfferButtons } from '@/components/ZoneOfferButtons';
import { EventPurchaseClient } from './EventPurchaseClient';
import { AffiliateRefCapture } from '@/components/AffiliateRefCapture';
import { api } from '@/lib/api';
import {
  buildEventJsonLd,
  localPosterFallback,
} from '@/lib/seo/event-jsonld';
import { absUrlWithOrigin, getSiteOrigin } from '@/lib/site-url';
import { fetchTenantCurrent } from '@/lib/tenant';
import styles from './event.module.scss';

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

type EventHit = {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  minPrice: number | string;
  /** Precio final al comprador, cargos e IVA incluidos. */
  minPriceAllIn?: number;
  currency: string;
  category?: string | null;
  image?: string | null;
  bannerImage?: string | null;
  venue?: { name: string; city: string };
};

const CATEGORY_LABEL: Record<string, string> = {
  MUSIC: 'Concierto',
  SPORTS: 'Deportes',
  THEATER: 'Teatro',
  COMEDY: 'Comedia',
  FESTIVAL: 'Festival',
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

/** Cartelera completa, reutilizada para calcular los eventos relacionados. */
const loadCatalog = cache(async () => api<EventHit[]>('/discovery/events?limit=40'));

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

  /*
   * El detalle y la cartelera para "también te puede interesar" no dependen uno
   * del otro: iban en serie y ahora salen a la vez. En 4G esto quita un viaje
   * completo del camino crítico.
   */
  const [settled, tenant, origin] = await Promise.all([
    Promise.allSettled([loadEvent(slug), loadCatalog()]),
    fetchTenantCurrent(),
    getSiteOrigin(),
  ]);
  const [eventResult, catalogResult] = settled;

  // Un evento inexistente es un 404, no una pantalla de error genérica.
  if (eventResult.status === 'rejected') notFound();
  const event = eventResult.value;
  const brandName = tenant.name;

  let related: EventHit[] = [];
  if (catalogResult.status === 'fulfilled') {
    const all = catalogResult.value;
    related = all
      .filter((e) => e.slug !== slug)
      .filter(
        (e) =>
          e.category === event.category || e.venue?.city === event.venue?.city,
      )
      .slice(0, 4);
    if (related.length < 3) {
      related = all.filter((e) => e.slug !== slug).slice(0, 4);
    }
  }

  const prices = event.offers.map((o) => Number(o.basePrice)).filter((n) => !Number.isNaN(n));
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const when = new Date(event.startsAt);
  const dateLabel = when.toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const timeLabel = when.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const shortDate = when.toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const venueLabel = [event.venue?.name, event.venue?.city].filter(Boolean).join(' · ');
  const priceFrom =
    minPrice > 0
      ? `$${minPrice.toLocaleString('es-MX', { maximumFractionDigits: 0 })} ${event.currency || 'MXN'}`
      : null;
  const poster = {
    id: event.id,
    slug: event.slug,
    title: event.title,
    category: event.category,
    image: event.image,
    bannerImage: event.bannerImage,
    startsAt: event.startsAt,
    posterAspect:
      event.posterAspect ??
      event.metadata?.posterAspect ??
      undefined,
  };
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
      <SiteHeader theme="dark" />
      <AffiliateRefCapture refCode={ref} eventId={event.id} />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroMedia}>
            {/* Único `priority` de la página: es el elemento LCP. */}
            <EventPosterArt event={poster} size="hero" priority />
          </div>
          <div className={styles.heroShade} aria-hidden="true" />
          <div className={styles.heroCopy}>
            <nav className={styles.crumb} aria-label="Ruta de navegación">
              <Link href="/">Cartelera</Link>
              <span aria-hidden="true">/</span>
              {event.category && (
                <>
                  <Link href={`/categoria/${event.category}`}>
                    {CATEGORY_LABEL[event.category] ?? event.category}
                  </Link>
                  <span aria-hidden="true">/</span>
                </>
              )}
              <span aria-current="page">{event.title}</span>
            </nav>
            <p className={styles.brandMark}>{brandName}</p>
            <div className={styles.heroBadges}>
              <Badge tone="accent" variant="solid" size="md">
                {CATEGORY_LABEL[event.category || ''] ?? 'Evento'}
              </Badge>
              {event.organization?.name && (
                <Badge tone="neutral" variant="outline" size="md">
                  {event.organization.name}
                </Badge>
              )}
            </div>
            <h1>{event.title}</h1>
            <ul className={styles.infoPills} aria-label="Detalles del evento">
              <li>
                <Badge tone="neutral" variant="soft" size="md" dot>
                  {shortDate} · {timeLabel}
                </Badge>
              </li>
              {venueLabel && (
                <li>
                  <Badge tone="neutral" variant="soft" size="md" dot>
                    {venueLabel}
                  </Badge>
                </li>
              )}
              {priceFrom && (
                <li>
                  <Badge tone="accent" variant="soft" size="md" dot>
                    Desde {priceFrom}
                  </Badge>
                </li>
              )}
            </ul>
            <div className={styles.heroCta}>
              <a href="#compra" className={styles.cta}>
                Comprar boletos
              </a>
              {priceFrom && <span className={styles.fromPrice}>Precio final con cargos incluidos</span>}
            </div>
          </div>
        </section>

        <section className={styles.trustStrip} aria-label="Garantías de compra">
          <ul>
            <li>
              <Badge tone="success" variant="soft" size="md">
                Boletos oficiales
              </Badge>
              <span>Emitidos por el promotor en {brandName}</span>
            </li>
            <li>
              <Badge tone="info" variant="soft" size="md">
                Pago Banorte
              </Badge>
              <span>Cobro directo a la cuenta del organizador</span>
            </li>
            <li>
              <Badge tone="neutral" variant="soft" size="md">
                Entrada con QR
              </Badge>
              <span>En tu celular o PDF listo para escanear</span>
            </li>
            <li>
              <Badge
                tone={event.transferAllowed === false || event.nonTransferable ? 'warning' : 'success'}
                variant="soft"
                size="md"
              >
                {event.transferAllowed === false || event.nonTransferable
                  ? 'No transferible'
                  : 'Transferible'}
              </Badge>
              <span>
                {event.transferAllowed === false || event.nonTransferable
                  ? 'Este evento no permite cesión de boletos'
                  : 'Cede boletos desde tu cuenta si lo necesitas'}
              </span>
            </li>
          </ul>
        </section>

        <div className={styles.shell}>
          <div className={styles.layout}>
            <div className={styles.mainCol}>
              {event.offers.length > 0 && (
                <Card className={styles.offersCard} padding="none" variant="elevated">
                  <CardHeader
                    as="h2"
                    title="Zonas y precios"
                    description="Elige una zona para filtrar el mapa y continuar al pago."
                  />
                  <div className={styles.offersBody}>
                    <ZoneOfferButtons
                      offers={event.offers}
                      currency={event.currency || 'MXN'}
                      activeZone={zone}
                    />
                  </div>
                </Card>
              )}

              <Card className={styles.purchaseCard} padding="none" variant="elevated">
                <CardHeader as="h2" title="Selecciona tus asientos" />
                {event.offers.length > 0 ? (
                  <EventPurchaseClient
                    eventId={event.id}
                    eventTitle={event.title}
                    slug={event.slug}
                    startsAt={event.startsAt}
                    venueName={event.venue?.name}
                    venueCity={event.venue?.city}
                    mapData={event.seatMap?.snapshotData}
                    offers={event.offers}
                    minPrice={minPrice}
                    minPriceAllIn={event.minPriceAllIn}
                    currency={event.currency || 'MXN'}
                    focusZone={zone ?? null}
                  />
                ) : (
                  <div className={styles.waitlistWrap}>
                    <WaitlistSignup eventId={event.id} eventTitle={event.title} />
                  </div>
                )}
              </Card>

              {event.description && (
                <Card className={styles.aboutCard} variant="elevated">
                  <CardHeader as="h2" title="Acerca del evento" />
                  <p className={styles.aboutText}>{event.description}</p>
                </Card>
              )}

              <details className={styles.info} open>
                <summary>Información importante</summary>
                <ul>
                  {event.venue && (
                    <li>
                      <strong>Venue</strong>
                      <span>
                        {[event.venue.name, event.venue.address, event.venue.city, event.venue.state]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </li>
                  )}
                  {event.rating && (
                    <li>
                      <strong>Clasificación</strong>
                      <span>{event.rating}</span>
                    </li>
                  )}
                  {event.genre && (
                    <li>
                      <strong>Género</strong>
                      <span>{event.genre}</span>
                    </li>
                  )}
                  <li>
                    <strong>Reembolso</strong>
                    <span>
                      {event.refundable === false
                        ? 'No reembolsable. '
                        : 'Sujeto a la política del promotor. '}
                      <Link href="/terminos#reembolsos">
                        Ver política de reembolsos y cambios
                      </Link>
                    </span>
                  </li>
                  <li>
                    <strong>Transferencia</strong>
                    <span>
                      {event.nonTransferable || event.transferAllowed === false
                        ? 'No transferible'
                        : 'Transferencia permitida desde tu cuenta'}
                    </span>
                  </li>
                  <li>
                    <strong>Reventa</strong>
                    <span>
                      {event.allowResale === false
                        ? 'Reventa no disponible'
                        : 'Reventa oficial permitida'}
                    </span>
                  </li>
                  <li>
                    <strong>Reserva</strong>
                    <span>
                      Los asientos se reservan{' '}
                      {Math.round((event.holdExpiration ?? 900) / 60)} minutos durante el checkout
                    </span>
                  </li>
                  {event.venue?.website && (
                    <li>
                      <strong>Sitio del venue</strong>
                      <span>
                        <a href={event.venue.website} target="_blank" rel="noreferrer">
                          {event.venue.website.replace(/^https?:\/\//, '')}
                          <span className="sr-only"> (se abre en una pestaña nueva)</span>
                        </a>
                      </span>
                    </li>
                  )}
                </ul>
              </details>
            </div>

            <aside className={styles.rail} aria-label="Resumen de compra">
              <Card className={styles.railCard} padding="sm" variant="elevated">
                <div className={styles.railArt}>
                  <EventPosterArt event={poster} size="lg" showDate />
                </div>
                <p className={styles.railTitle}>{event.title}</p>
                <p className={styles.railMeta}>
                  {dateLabel}
                  <br />
                  {timeLabel}
                  {event.venue?.name ? ` · ${event.venue.name}` : ''}
                </p>
                {priceFrom && <p className={styles.railPrice}>Desde {priceFrom}</p>}
                <CardFooter className={styles.railFooter}>
                  <a href="#compra" className={styles.cta}>
                    Ir a comprar
                  </a>
                  <div className={styles.railTrust}>
                    <Badge tone="success" variant="soft" size="sm">
                      Boletos oficiales
                    </Badge>
                    <Badge tone="info" variant="soft" size="sm">
                      Pago Banorte
                    </Badge>
                    <Badge tone="neutral" variant="soft" size="sm">
                      Entrada con QR
                    </Badge>
                    <Badge tone="warning" variant="outline" size="sm">
                      Hold {Math.round((event.holdExpiration ?? 900) / 60)} min
                    </Badge>
                  </div>
                </CardFooter>
              </Card>
            </aside>
          </div>

          {related.length > 0 && (
            <Section
              className={styles.related}
              title="También te puede interesar"
              headingLevel="h2"
              columns={4}
              gap="md"
            >
              {related.map((e) => (
                <Link key={e.id} href={`/events/${e.slug}`} className={styles.relatedCard}>
                  <Card interactive padding="none" variant="elevated" className={styles.relatedInner}>
                    <div className={styles.relatedArt}>
                      <EventPosterArt event={e} size="lg" showDate />
                    </div>
                    <div className={styles.relatedBody}>
                      <Badge tone="accent" variant="soft" size="sm">
                        {CATEGORY_LABEL[e.category || ''] ?? 'Evento'}
                      </Badge>
                      <strong>{e.title}</strong>
                      <span>
                        {e.venue?.city}
                        {e.venue?.city ? ' · ' : ''}
                        Desde $
                        {Number(e.minPrice).toLocaleString('es-MX', {
                          maximumFractionDigits: 0,
                        })}
                      </span>
                    </div>
                  </Card>
                </Link>
              ))}
            </Section>
          )}
        </div>

        <div className={styles.mobileBuyBar} aria-label="Comprar boletos">
          <div className={styles.mobileBuyMeta}>
            <strong>{event.title}</strong>
            {priceFrom && <span>Desde {priceFrom}</span>}
          </div>
          <a href="#compra" className={styles.cta}>
            Comprar boletos
          </a>
        </div>
      </main>
    </>
  );
}
