import Link from 'next/link';
import {
  EVENT_STOCK_IMAGES,
  resolveCityImage,
  resolveCuratedCards,
  type CuratedMarketingCard,
  type SiteContent,
} from '@boletera/shared';
import { Badge, Card } from '@boletera/ui';
import { EventPosterArt } from './EventPosterArt';
import type { EventHit } from './EventDiscoveryPanel';
import styles from './HomeModules.module.scss';

type CityFacet = { name: string; count: number };
type VenueHit = {
  id: string;
  slug: string;
  name: string;
  city: string;
  state?: string;
  image?: string | null;
  eventCount: number;
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function fmtPrice(n: number | string) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 'Consultar';
  return `Desde $${v.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
}

export function HomeModules({
  trending,
  cities,
  venues,
  failed,
  siteContent,
}: {
  trending: EventHit[];
  cities: CityFacet[];
  venues: VenueHit[];
  /** Ninguna de las tres consultas de descubrimiento respondió. */
  failed?: boolean;
  /** CMS del tenant; si falta o viene vacío, se usa stock compartido. */
  siteContent?: Pick<SiteContent, 'curatedCards' | 'cityImages'> | null;
}) {
  const experiences: CuratedMarketingCard[] = resolveCuratedCards(siteContent);
  const hasAnything = trending.length > 0 || cities.length > 0 || venues.length > 0;

  /*
   * Antes, si el API no respondía, media home quedaba en blanco sin explicar
   * nada. Ahora el bloque dice qué pasó y ofrece una salida.
   */
  if (!hasAnything) {
    return (
      <div className={styles.wrap}>
        <div className={styles.fallback} role={failed ? 'alert' : undefined}>
          <p className={styles.fallbackTitle}>
            {failed
              ? 'No pudimos cargar las secciones de la home'
              : 'Todavía estamos armando la cartelera'}
          </p>
          <p>
            {failed
              ? 'Es un problema temporal de nuestro lado. Recarga la página en un momento.'
              : 'En cuanto haya eventos publicados verás aquí lo más buscado, las ciudades y los recintos.'}
          </p>
          <Link href="/ayuda" className={styles.fallbackLink}>
            Ir a Ayuda
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {trending.length > 0 && (
        <section
          className={`${styles.band} ${styles.bandLight}`}
          aria-labelledby="home-trending"
        >
          <div className={styles.bandInner}>
            <div className={styles.head}>
              <h2 id="home-trending">Lo más buscado</h2>
              <Link href="/">Ver cartelera</Link>
            </div>
          </div>
          <div className={styles.carouselViewport} tabIndex={0} aria-label="Eventos más buscados">
            <ul className={styles.carouselTrack}>
              {trending.map((e) => (
                <li key={e.id} className={styles.carouselItem}>
                  <Link href={`/events/${e.slug}`} className={styles.trendLink}>
                    <Card padding="none" interactive className={styles.trendCard}>
                      <div className={styles.trendArt}>
                        <EventPosterArt event={e} size="lg" showDate />
                      </div>
                      <div className={styles.trendMeta}>
                        <strong>{e.title}</strong>
                        <span>
                          {fmtDate(e.startsAt)}
                          {e.venue?.city ? ` · ${e.venue.city}` : ''}
                        </span>
                        <em>{fmtPrice(e.minPrice)}</em>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section
        className={`${styles.band} ${styles.bandMuted}`}
        aria-labelledby="home-experiences"
      >
        <div className={styles.bandInner}>
          <div className={styles.head}>
            <h2 id="home-experiences">Experiencias destacadas</h2>
            <Link href="/">Explorar cartelera</Link>
          </div>
          <ul className={styles.experiences}>
            {experiences.map((item) => (
              <li key={`${item.href}-${item.title}`}>
                <Link href={item.href} className={styles.experienceCard}>
                  <Card padding="none" interactive className={styles.experienceSurface}>
                    <div
                      className={styles.experienceArt}
                      style={{ backgroundImage: `url(${item.image})` }}
                    >
                      <div className={styles.experienceOverlay} aria-hidden="true" />
                      <Badge tone="accent" variant="solid" size="sm" className={styles.experienceBadge}>
                        Destacado
                      </Badge>
                      <div className={styles.experienceCopy}>
                        <strong>{item.title}</strong>
                        <span>{item.subtitle}</span>
                      </div>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {cities.length > 0 && (
        <section
          className={`${styles.band} ${styles.bandWarm}`}
          aria-labelledby="home-cities"
        >
          <div className={styles.bandInner}>
            <div className={styles.head}>
              <h2 id="home-cities">Ciudades más buscadas</h2>
              <Link href="/ciudades">Ver todas</Link>
            </div>
          </div>
          <div className={styles.carouselViewport} tabIndex={0} aria-label="Ciudades más buscadas">
            <ul className={styles.carouselTrack}>
              {cities.map((c) => {
                const photo = resolveCityImage(
                  c.name,
                  siteContent,
                  EVENT_STOCK_IMAGES.OPEN_AIR,
                );
                return (
                  <li key={c.name} className={styles.cityItem}>
                    <Link
                      href={`/ciudades/${encodeURIComponent(c.name)}`}
                      className={styles.cityCard}
                    >
                      <Card padding="none" interactive className={styles.citySurface}>
                        <div
                          className={styles.cityPhoto}
                          style={{ backgroundImage: `url(${photo})` }}
                        >
                          <div className={styles.cityOverlay} aria-hidden="true" />
                          <div className={styles.cityCopy}>
                            <strong>{c.name}</strong>
                            <span>
                              {c.count} evento{c.count === 1 ? '' : 's'}
                            </span>
                          </div>
                        </div>
                      </Card>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {venues.length > 0 && (
        <section
          className={`${styles.band} ${styles.bandDark}`}
          aria-labelledby="home-venues"
        >
          <div className={styles.bandInner}>
            <div className={styles.head}>
              <h2 id="home-venues">Inmuebles</h2>
              <Link href="/venues">Ver recintos</Link>
            </div>
          </div>
          <div className={styles.carouselViewport} tabIndex={0} aria-label="Recintos destacados">
            <ul className={`${styles.carouselTrack} ${styles.venueTrack}`}>
              {venues.map((v) => (
                <li key={v.id} className={styles.venueItem}>
                  <Link href={`/venues/${v.slug}`} className={styles.venueLink}>
                    <Card padding="none" interactive className={styles.venueCard}>
                      <div className={styles.venueArt}>
                        {v.image ? (
                          /* Decorativa: el nombre del recinto va como texto debajo. */
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={v.image} alt="" loading="lazy" decoding="async" />
                        ) : null}
                        <Badge tone="accent" variant="solid" size="sm" className={styles.venueBadge}>
                          {v.eventCount} evento{v.eventCount === 1 ? '' : 's'}
                        </Badge>
                      </div>
                      <div className={styles.venueMeta}>
                        <strong>{v.name}</strong>
                        <span>
                          {v.city}
                          {v.state ? `, ${v.state}` : ''}
                        </span>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
