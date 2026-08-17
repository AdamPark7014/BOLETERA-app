import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { EventPosterArt } from '@/components/EventPosterArt';
import { api } from '@/lib/api';
import type { EventHit } from '@/components/EventDiscoveryPanel';
import styles from '../../hub.module.scss';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function CiudadPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city: raw } = await params;
  const city = decodeURIComponent(raw);
  let events: EventHit[] = [];
  let failed = false;
  try {
    events = await api<EventHit[]>(
      `/discovery/events?city=${encodeURIComponent(city)}&limit=60`,
    );
  } catch {
    failed = true;
  }

  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        <nav className={styles.crumb} aria-label="Ruta de navegación">
          <Link href="/">Cartelera</Link>
          <span aria-hidden="true">/</span>
          <Link href="/ciudades">Ciudades</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{city}</span>
        </nav>
        <header className={styles.hero}>
          <h1>{city}</h1>
          <p>
            {failed
              ? 'No pudimos consultar la cartelera de esta ciudad.'
              : `${events.length} evento${events.length === 1 ? '' : 's'} disponible${
                  events.length === 1 ? '' : 's'
                }`}
          </p>
        </header>

        {failed ? (
          <div className={styles.error} role="alert">
            <strong>No pudimos cargar los eventos de {city}</strong>
            <p>Es un problema temporal. Vuelve a intentarlo en unos minutos.</p>
            <Link href="/ciudades">Ver otras ciudades</Link>
          </div>
        ) : events.length === 0 ? (
          <div className={styles.empty}>
            <strong>Sin eventos en {city} por ahora</strong>
            <p>Todavía no hay funciones anunciadas en esta ciudad.</p>
            <Link href="/ciudades">Ver otras ciudades</Link>
          </div>
        ) : (
          <ul className={styles.grid}>
            {events.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.slug}`} className={styles.card}>
                  <EventPosterArt event={e} size="sm" />
                  <div>
                    <strong>{e.title}</strong>
                    <span>
                      {fmtDate(e.startsAt)}
                      {e.venue?.name ? ` · ${e.venue.name}` : ''}
                    </span>
                  </div>
                  <em>
                    {/* Precio FINAL con cargos e IVA: anunciar el base sería
                        publicitar un 26% menos de lo que se cobra. */}
                    {Number(e.minPriceAllIn ?? e.minPrice) > 0
                      ? `$${Number(e.minPriceAllIn ?? e.minPrice).toLocaleString('es-MX', {
                          maximumFractionDigits: 0,
                        })}`
                      : 'Consultar'}
                  </em>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
