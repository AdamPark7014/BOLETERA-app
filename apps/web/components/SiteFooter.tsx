import Link from 'next/link';
import { Suspense } from 'react';
import { api } from '@/lib/api';
import { FALLBACK_TENANT, fetchTenantCurrent } from '@/lib/tenant';
import styles from './SiteFooter.module.scss';

const CATEGORIES = [
  { key: 'MUSIC', label: 'Conciertos' },
  { key: 'SPORTS', label: 'Deportes' },
  { key: 'THEATER', label: 'Artes' },
  { key: 'COMEDY', label: 'Comedia' },
  { key: 'FESTIVAL', label: 'Festivales' },
  { key: 'FAMILY', label: 'Familiares' },
];

type CityFacet = { name: string; count: number };

async function FooterCities() {
  let cities: CityFacet[] = [];
  try {
    const data = await api<{ cities?: CityFacet[] }>('/discovery/facets');
    cities = data.cities?.slice(0, 8) ?? [];
  } catch {
    cities = [];
  }

  return (
    <>
      {cities.map((c) => (
        <li key={c.name}>
          <Link href={`/ciudades/${encodeURIComponent(c.name)}`}>{c.name}</Link>
        </li>
      ))}
    </>
  );
}

export async function SiteFooter() {
  const tenant = await fetchTenantCurrent();
  const brand = tenant.name?.trim() || FALLBACK_TENANT.name;
  const isProd = process.env.NODE_ENV === 'production';

  return (
    <footer className={styles.footer}>
      <h2 className="sr-only">Pie de página</h2>

      <div className={styles.inner}>
        <div className={styles.brandCol}>
          <p className={styles.brand}>{brand}</p>
          <p className={styles.tagline}>Boletos oficiales · Pagos Banorte · Acceso con QR</p>
        </div>

        <div className={styles.col}>
          <h3>Categorías</h3>
          <ul>
            {CATEGORIES.map((c) => (
              <li key={c.key}>
                <Link href={`/categoria/${c.key}`}>{c.label}</Link>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.col}>
          <h3>Ciudades</h3>
          <ul className={styles.cityList}>
            <li>
              <Link href="/ciudades">Todas las ciudades</Link>
            </li>
            <Suspense fallback={null}>
              <FooterCities />
            </Suspense>
          </ul>
        </div>

        <div className={styles.col}>
          <h3>Explorar</h3>
          <ul>
            <li>
              <Link href="/venues">Recintos</Link>
            </li>
            <li>
              <Link href="/resale">Reventa</Link>
            </li>
            <li>
              <Link href="/ayuda">Ayuda</Link>
            </li>
            <li>
              <Link href="/cuenta">Mi cuenta</Link>
            </li>
          </ul>
        </div>

        <div className={styles.col}>
          <h3>Legal</h3>
          <ul>
            <li>
              <Link href="/terminos">Términos{!isProd ? ' (borrador)' : ''}</Link>
            </li>
            <li>
              <Link href="/privacidad">Privacidad{!isProd ? ' (borrador)' : ''}</Link>
            </li>
          </ul>
        </div>
      </div>

      <p className={styles.copy}>
        © {new Date().getFullYear()} {brand} · Liquidación Banorte
      </p>
    </footer>
  );
}
