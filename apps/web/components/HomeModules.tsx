import Link from 'next/link';
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
}: {
  trending: EventHit[];
  cities: CityFacet[];
  venues: VenueHit[];
  /** Ninguna de las tres consultas de descubrimiento respondió. */
  failed?: boolean;
}) {
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
        <section className={styles.section} aria-labelledby="home-trending">
          <div className={styles.head}>
            <h2 id="home-trending">Lo más buscado</h2>
            <Link href="/">Ver cartelera</Link>
          </div>
          <ul className={styles.trending}>
            {trending.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.slug}`} className={styles.trendCard}>
                  <div className={styles.trendArt}>
                    <EventPosterArt event={e} size="lg" showDate />
                  </div>
                  <div>
                    <strong>{e.title}</strong>
                    <span>
                      {fmtDate(e.startsAt)}
                      {e.venue?.city ? ` · ${e.venue.city}` : ''}
                    </span>
                    <em>{fmtPrice(e.minPrice)}</em>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cities.length > 0 && (
        <section className={styles.section} aria-labelledby="home-cities">
          <div className={styles.head}>
            <h2 id="home-cities">Ciudades más buscadas</h2>
            <Link href="/ciudades">Ver todas</Link>
          </div>
          <div className={styles.cities}>
            {cities.map((c) => (
              <Link
                key={c.name}
                href={`/ciudades/${encodeURIComponent(c.name)}`}
                className={styles.cityCard}
              >
                <strong>{c.name}</strong>
                <span>
                  {c.count} evento{c.count === 1 ? '' : 's'}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {venues.length > 0 && (
        <section className={styles.section} aria-labelledby="home-venues">
          <div className={styles.head}>
            <h2 id="home-venues">Inmuebles</h2>
            <Link href="/venues">Ver recintos</Link>
          </div>
          <ul className={styles.venues}>
            {venues.map((v) => (
              <li key={v.id}>
                <Link href={`/venues/${v.slug}`} className={styles.venueCard}>
                  <div className={styles.venueArt}>
                    {v.image ? (
                      /* Decorativa: el nombre del recinto va como texto debajo. */
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.image} alt="" loading="lazy" decoding="async" />
                    ) : null}
                  </div>
                  <div>
                    <strong>{v.name}</strong>
                    <span>
                      {v.city}
                      {v.state ? `, ${v.state}` : ''} · {v.eventCount} evento
                      {v.eventCount === 1 ? '' : 's'}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
