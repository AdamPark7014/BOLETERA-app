import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { api } from '@/lib/api';
import { buildHubMetadata } from '@/lib/seo';
import { fetchTenantCurrent } from '@/lib/tenant';
import styles from '../hub.module.scss';
import { PageTitle, TicketState } from '@boletera/ui';

type CityFacet = { name: string; count: number };

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await fetchTenantCurrent();
  return buildHubMetadata({
    title: 'Ciudades',
    description: `Explora la cartelera de eventos por ciudad en ${tenant.name}.`,
    path: '/ciudades',
  });
}

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
        <PageTitle title="Ciudades" />

        {failed ? (
          <TicketState
            kind="error"
            title="No pudimos cargar las ciudades"
            body="Vuelve a intentarlo en unos minutos."
            action={
              <Link href="/" className="bt-action">
                Ver la cartelera
              </Link>
            }
          />
        ) : cities.length === 0 ? (
          <TicketState
            kind="empty"
            title="Aún no hay ciudades con cartelera"
            body="En cuanto se publiquen eventos verás aquí sus ciudades."
            action={
              <Link href="/" className="bt-action">
                Ver la cartelera
              </Link>
            }
          />
        ) : (
          <ul className={styles.cityGrid}>
            {cities.map((c) => (
              <li key={c.name}>
                <Link href={`/ciudades/${encodeURIComponent(c.name)}`} className={styles.cityTile}>
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
