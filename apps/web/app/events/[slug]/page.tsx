import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { EventPosterArt } from '@/components/EventPosterArt';
import { WaitlistSignup } from '@/components/WaitlistSignup';
import { ZoneOfferButtons } from '@/components/ZoneOfferButtons';
import { EventPurchaseClient } from './EventPurchaseClient';
import { AffiliateRefCapture } from '@/components/AffiliateRefCapture';
import { api } from '@/lib/api';
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
  offers: { id: string; zone: string; name?: string; basePrice: string; remainingQuantity?: number }[];
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

const SITE = process.env.NEXT_PUBLIC_WEB_URL || 'http://localhost:3000';

function absUrl(path?: string | null) {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE}${path.startsWith('/') ? path : `/${path}`}`;
}

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
    const event = await loadEvent(slug);
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
    const image = absUrl(event.bannerImage || event.image);
    const url = `${SITE}/events/${slug}`;
    return {
      title,
      description,
      openGraph: {
        title,
        description,
        url,
        type: 'website',
        locale: 'es_MX',
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
    return { title: 'Evento | BOLETERA' };
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
  const [eventResult, catalogResult] = await Promise.allSettled([
    loadEvent(slug),
    loadCatalog(),
  ]);

  // Un evento inexistente es un 404, no una pantalla de error genérica.
  if (eventResult.status === 'rejected') notFound();
  const event = eventResult.value;

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
  const end = event.endsAt ? new Date(event.endsAt) : new Date(when.getTime() + 3 * 60 * 60 * 1000);
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
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    description: event.description,
    startDate: event.startsAt,
    endDate: end.toISOString(),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    image: absUrl(event.bannerImage || event.image),
    location: event.venue
      ? {
          '@type': 'Place',
          name: event.venue.name,
          address: {
            '@type': 'PostalAddress',
            addressLocality: event.venue.city,
            streetAddress: event.venue.address || undefined,
            addressCountry: 'MX',
          },
        }
      : undefined,
    offers: {
      '@type': 'AggregateOffer',
      lowPrice: minPrice,
      priceCurrency: event.currency || 'MXN',
      availability: 'https://schema.org/InStock',
      url: `${SITE}/events/${slug}`,
    },
    organizer: event.organization?.name
      ? { '@type': 'Organization', name: event.organization.name }
      : undefined,
  };

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
            <p className={styles.brandMark}>BOLETERA</p>
            <p className={styles.eyebrow}>
              {CATEGORY_LABEL[event.category || ''] ?? 'Evento'}
              {event.organization?.name ? ` · ${event.organization.name}` : ''}
            </p>
            <h1>{event.title}</h1>
            <p className={styles.meta}>
              {dateLabel} · {timeLabel}
            </p>
            <p className={styles.venue}>
              {event.venue?.name}
              {event.venue?.city ? ` · ${event.venue.city}` : ''}
            </p>
            <div className={styles.heroCta}>
              <a href="#compra" className={styles.cta}>
                Comprar boletos
              </a>
              {minPrice > 0 && (
                <span className={styles.fromPrice}>
                  Desde ${minPrice.toLocaleString('es-MX', { maximumFractionDigits: 0 })}{' '}
                  {event.currency || 'MXN'}
                </span>
              )}
            </div>
          </div>
        </section>

        <section className={styles.trustStrip} aria-label="Garantías de compra">
          <ul>
            <li>
              <strong>Boletos oficiales</strong>
              <span>Emitidos por el promotor en BOLETERA</span>
            </li>
            <li>
              <strong>Pago Banorte</strong>
              <span>Cobro directo a la cuenta del organizador</span>
            </li>
            <li>
              <strong>Entrada con QR</strong>
              <span>En tu celular o PDF listo para escanear</span>
            </li>
            <li>
              <strong>
                {event.transferAllowed === false || event.nonTransferable
                  ? 'No transferible'
                  : 'Transferible'}
              </strong>
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
                <section className={styles.offers} aria-label="Precios">
                  <h2>Zonas y precios</h2>
                  <p className={styles.sectionLead}>
                    Elige una zona para filtrar el mapa y continuar al pago.
                  </p>
                  <ZoneOfferButtons
                    offers={event.offers}
                    currency={event.currency || 'MXN'}
                    activeZone={zone}
                  />
                </section>
              )}

              <section className={styles.purchase} aria-label="Comprar">
                <h2>Selecciona tus asientos</h2>
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
                  <WaitlistSignup eventId={event.id} eventTitle={event.title} />
                )}
              </section>

              {event.description && (
                <section className={styles.about} aria-label="Acerca del evento">
                  <h2>Acerca del evento</h2>
                  <p>{event.description}</p>
                </section>
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
              <div className={styles.railCard}>
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
                {minPrice > 0 && (
                  <p className={styles.railPrice}>
                    Desde ${minPrice.toLocaleString('es-MX', { maximumFractionDigits: 0 })}{' '}
                    {event.currency || 'MXN'}
                  </p>
                )}
                <a href="#compra" className={styles.cta}>
                  Ir a comprar
                </a>
                <ul className={styles.railTrust}>
                  <li>Boletos oficiales</li>
                  <li>Pago Banorte</li>
                  <li>Entrada con QR</li>
                  <li>
                    Hold {Math.round((event.holdExpiration ?? 900) / 60)} min al elegir
                  </li>
                  {event.organization?.name && (
                    <li>Organiza {event.organization.name}</li>
                  )}
                </ul>
              </div>
            </aside>
          </div>

          {related.length > 0 && (
            <section className={styles.related} aria-label="Más eventos">
              <h2>También te puede interesar</h2>
              <ul>
                {related.map((e) => (
                  <li key={e.id}>
                    <Link href={`/events/${e.slug}`} className={styles.relatedCard}>
                      <div className={styles.relatedArt}>
                        <EventPosterArt event={e} size="lg" showDate />
                      </div>
                      <div>
                        <p className={styles.relatedCat}>
                          {CATEGORY_LABEL[e.category || ''] ?? 'Evento'}
                        </p>
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
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
