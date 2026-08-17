import Link from 'next/link';
import { Suspense } from 'react';
import styles from './SiteFooter.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

const CATEGORIES = [
  { key: 'MUSIC', label: 'Conciertos' },
  { key: 'SPORTS', label: 'Deportes' },
  { key: 'THEATER', label: 'Artes' },
  { key: 'COMEDY', label: 'Comedia' },
  { key: 'FESTIVAL', label: 'Festivales' },
  { key: 'FAMILY', label: 'Familiares' },
];

type CityFacet = { name: string; count: number };

/*
 * El pie salía como componente de cliente solo para pedir las ciudades al
 * montar: eso arrastraba JavaScript y una petición extra en CADA página del
 * sitio, y provocaba un salto de layout cuando la lista llegaba. Ahora se
 * resuelve en el servidor, con caché de 10 minutos (las ciudades con cartelera
 * cambian por día, no por segundo) y dentro de <Suspense> para que el pie se
 * pinte de inmediato aunque el API tarde.
 */
async function FooterCities() {
  let cities: CityFacet[] = [];
  try {
    const res = await fetch(`${API}/discovery/facets`, {
      next: { revalidate: 600 },
    });
    if (res.ok) {
      const data = (await res.json()) as { cities?: CityFacet[] };
      cities = data.cities?.slice(0, 8) ?? [];
    }
  } catch {
    cities = [];
  }

  // Si el API no responde, el enlace "Todas las ciudades" del fallback basta.
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

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <h2 className="sr-only">Pie de página</h2>
      <div className={styles.inner}>
        <div className={styles.brandCol}>
          <p className={styles.brand}>BOLETERA</p>
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
          {/* min-height reserva el alto de la lista para no provocar CLS. */}
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
              <Link href="/terminos">Términos y condiciones</Link>
            </li>
            <li>
              <Link href="/terminos#reembolsos">Reembolsos y cambios</Link>
            </li>
            <li>
              <Link href="/privacidad">Aviso de privacidad</Link>
            </li>
            <li>
              <Link href="/privacidad#arco">Derechos ARCO</Link>
            </li>
          </ul>
        </div>
      </div>
      <p className={styles.copy}>
        © {new Date().getFullYear()} BOLETERA · Liquidación Banorte
      </p>
    </footer>
  );
}
