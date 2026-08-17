import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { api } from '@/lib/api';
import styles from '../hub.module.scss';

type CityFacet = { name: string; count: number };

export const metadata: Metadata = {
  title: 'Ciudades | Boletera',
  description: 'Explora la cartelera de eventos por ciudad en México.',
};

export default async function CiudadesPage() {
  let cities: CityFacet[] = [];
  let failed = false;
  try {
    const facets = await api<{ cities: CityFacet[] }>('/discovery/facets');
    cities = facets.cities ?? [];
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
          <span aria-current="page">Ciudades</span>
        </nav>
        <header className={styles.hero}>
          <h1>Ciudades</h1>
          <p>Explora eventos por ciudad en México.</p>
        </header>

        {failed ? (
          <div className={styles.error} role="alert">
            <strong>No pudimos cargar las ciudades</strong>
            <p>Vuelve a intentarlo en unos minutos.</p>
            <Link href="/">Ver la cartelera</Link>
          </div>
        ) : cities.length === 0 ? (
          <div className={styles.empty}>
            <strong>Aún no hay ciudades con cartelera</strong>
            <p>En cuanto se publiquen eventos verás aquí sus ciudades.</p>
            <Link href="/">Ver la cartelera</Link>
          </div>
        ) : (
          <ul className={styles.cityGrid}>
            {cities.map((c) => (
              <li key={c.name}>
                <Link
                  href={`/ciudades/${encodeURIComponent(c.name)}`}
                  className={styles.cityTile}
                >
                  <strong>{c.name}</strong>
                  <span>
                    {c.count} evento{c.count === 1 ? '' : 's'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
