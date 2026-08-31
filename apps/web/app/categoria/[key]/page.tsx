import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { EventPosterArt } from '@/components/EventPosterArt';
import { api } from '@/lib/api';
import type { EventHit } from '@/components/EventDiscoveryPanel';
import { buildHubMetadata } from '@/lib/seo';
import { fetchTenantCurrent } from '@/lib/tenant';
import styles from '../../hub.module.scss';

const CATEGORY_LABEL: Record<string, string> = {
  MUSIC: 'Conciertos',
  SPORTS: 'Deportes',
  THEATER: 'Artes y teatro',
  COMEDY: 'Comedia',
  FESTIVAL: 'Festivales',
  FAMILY: 'Familiares',
  STANDUP: 'Stand-up',
  CINEMA: 'Cine',
  OTHER: 'Eventos',
};

const ALLOWED = new Set(Object.keys(CATEGORY_LABEL));

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<Metadata> {
  const { key: raw } = await params;
  const key = raw.toUpperCase();
  const label = CATEGORY_LABEL[key] ?? key;
  const tenant = await fetchTenantCurrent();
  return buildHubMetadata({
    title: label,
    description: `${label} en cartelera en ${tenant.name}. Compra boletos oficiales con pago Banorte.`,
    path: `/categoria/${key}`,
  });
}

export default async function CategoriaPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key: raw } = await params;
  const key = raw.toUpperCase();
  if (!ALLOWED.has(key)) notFound();

  let events: EventHit[] = [];
  let failed = false;
  try {
    events = await api<EventHit[]>(
      `/discovery/events?category=${encodeURIComponent(key)}&limit=60`,
    );
  } catch {
    failed = true;
  }

  const label = CATEGORY_LABEL[key] ?? key;

  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        <nav className={styles.crumb} aria-label="Ruta de navegación">
          <Link href="/">Cartelera</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{label}</span>
        </nav>
        <header className={styles.hero}>
          <h1>{label}</h1>
          <p>
            {failed
              ? 'No pudimos consultar esta categoría.'
              : `${events.length} evento${events.length === 1 ? '' : 's'} en cartelera`}
          </p>
        </header>

        {failed ? (
          <div className={styles.error} role="alert">
            <strong>No pudimos cargar los eventos de {label}</strong>
            <p>Es un problema temporal. Vuelve a intentarlo en unos minutos.</p>
            <Link href="/">Ver toda la cartelera</Link>
          </div>
        ) : events.length === 0 ? (
          <div className={styles.empty}>
            <strong>Sin eventos en {label} por ahora</strong>
            <p>Prueba con otra categoría o revisa la cartelera completa.</p>
            <Link href="/">Ver toda la cartelera</Link>
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
                      {e.venue?.city ? ` · ${e.venue.city}` : ''}
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
