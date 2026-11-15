import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { api } from '@/lib/api';
import type { EventHit } from '@/components/EventDiscoveryPanel';
import { buildHubMetadata } from '@/lib/seo';
import { fetchTenantCurrent } from '@/lib/tenant';
import styles from '../../hub.module.scss';
import { EventCard, type CardEvent } from '@/components/home/EventCard';
import homeStyles from '@/components/home/home.module.scss';
import { TicketState } from '@boletera/ui';

type VenueDetail = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  website?: string | null;
  image?: string | null;
  totalCapacity?: number;
  events: EventHit[];
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await fetchTenantCurrent();
  try {
    const venue = await api<VenueDetail>(`/discovery/venues/${slug}`);
    if (!venue?.name) {
      return { title: `Recinto | ${tenant.name}` };
    }
    return buildHubMetadata({
      title: venue.name,
      description:
        venue.description?.slice(0, 155) ||
        `${venue.name} en ${venue.city}: cartelera y boletos oficiales en ${tenant.name}.`,
      path: `/venues/${slug}`,
      image: venue.image,
    });
  } catch {
    return { title: `Recinto | ${tenant.name}` };
  }
}

export default async function VenuePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let venue: VenueDetail | null = null;
  try {
    venue = await api<VenueDetail>(`/discovery/venues/${slug}`);
  } catch {
    venue = null;
  }

  if (!venue) notFound();

  const mapsUrl =
    venue.latitude != null && venue.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${venue.latitude},${venue.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${venue.name} ${venue.address} ${venue.city}`
        )}`;

  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        <nav className={styles.crumb} aria-label="Ruta de navegación">
          <Link href="/">Cartelera</Link>
          <span aria-hidden="true">/</span>
          <Link href="/venues">Recintos</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{venue.name}</span>
        </nav>
        <header className={styles.hero}>
          <h1>{venue.name}</h1>
          <p>
            {venue.city}
            {venue.state ? `, ${venue.state}` : ''}
          </p>
        </header>

        <section className={styles.metaBlock} aria-label="Datos del recinto">
          <p>
            <strong>Dirección:</strong> {venue.address}
            {venue.postalCode ? ` · CP ${venue.postalCode}` : ''}
          </p>
          {venue.description && <p>{venue.description}</p>}
          {typeof venue.totalCapacity === 'number' && (
            <p>
              <strong>Capacidad:</strong> {venue.totalCapacity.toLocaleString('es-MX')}
            </p>
          )}
          {venue.phone && (
            <p>
              <strong>Teléfono:</strong> {venue.phone}
            </p>
          )}
          <p>
            <a href={mapsUrl} target="_blank" rel="noreferrer">
              Cómo llegar
              <span className="sr-only"> (se abre en una pestaña nueva)</span>
            </a>
            {venue.website ? (
              <>
                {' · '}
                <a href={venue.website} target="_blank" rel="noreferrer">
                  Sitio del recinto
                  <span className="sr-only"> (se abre en una pestaña nueva)</span>
                </a>
              </>
            ) : null}
          </p>
        </section>

        <h2 className={styles.sectionTitle}>Próximos eventos</h2>
        {venue.events.length === 0 ? (
          <TicketState
            kind="empty"
            title="Sin eventos programados"
            body="Este recinto no tiene funciones anunciadas por ahora."
            action={
              <Link href="/" className="bt-action">
                Ver otros eventos
              </Link>
            }
          />
        ) : (
          <ul className={homeStyles.grid}>
            {venue.events.map((e) => (
              <li key={e.id}>
                <EventCard
                  event={{ ...e, venue: { name: venue.name, city: venue.city } } as CardEvent}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
