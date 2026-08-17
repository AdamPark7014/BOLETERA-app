import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { api } from '@/lib/api';
import styles from '../hub.module.scss';

type VenueHit = {
  id: string;
  slug: string;
  name: string;
  city: string;
  state?: string;
  image?: string | null;
  eventCount: number;
};

export const metadata: Metadata = {
  title: 'Recintos | Boletera',
  description: 'Inmuebles y recintos con cartelera activa en México.',
};

export default async function VenuesPage() {
  let venues: VenueHit[] = [];
  let failed = false;
  try {
    venues = await api<VenueHit[]>('/discovery/venues?limit=40');
  } catch {
    // "No hay recintos" y "no pudimos consultarlos" no se le dicen igual a nadie.
    failed = true;
  }

  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        <nav className={styles.crumb} aria-label="Ruta de navegación">
          <Link href="/">Cartelera</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Recintos</span>
        </nav>
        <header className={styles.hero}>
          <h1>Inmuebles</h1>
          <p>Recintos con cartelera activa.</p>
        </header>

        {failed ? (
          <div className={styles.error} role="alert">
            <strong>No pudimos cargar los recintos</strong>
            <p>
              Es un problema temporal de nuestro lado. Vuelve a intentarlo en unos
              minutos.
            </p>
            <Link href="/">Ver la cartelera</Link>
          </div>
        ) : venues.length === 0 ? (
          <div className={styles.empty}>
            <strong>Aún no hay recintos publicados</strong>
            <p>Cuando un promotor publique eventos, su recinto aparecerá aquí.</p>
            <Link href="/">Ver la cartelera</Link>
          </div>
        ) : (
          <ul className={styles.venueGrid}>
            {venues.map((v) => (
              <li key={v.id}>
                <Link href={`/venues/${v.slug}`} className={styles.venueTile}>
                  <div className={styles.art}>
                    {v.image ? (
                      /* Decorativa: el nombre del recinto va en texto debajo. */
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.image} alt="" loading="lazy" decoding="async" />
                    ) : null}
                  </div>
                  <div className={styles.body}>
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
        )}
      </main>
    </>
  );
}
