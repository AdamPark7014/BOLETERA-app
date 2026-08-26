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

const SOCIAL_LINKS = [
  { label: 'Instagram', href: 'https://instagram.com', icon: 'IG' },
  { label: 'X (Twitter)', href: 'https://x.com', icon: 'X' },
  { label: 'TikTok', href: 'https://tiktok.com', icon: 'TT' },
  { label: 'YouTube', href: 'https://youtube.com', icon: 'YT' },
];

type CityFacet = { name: string; count: number };

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

      <section className={styles.newsletter} aria-labelledby="footer-newsletter-heading">
        <div className={styles.newsletterInner}>
          <div className={styles.newsletterCopy}>
            <p className={styles.newsletterEyebrow}>Newsletter</p>
            <h3 id="footer-newsletter-heading">Boletos antes que nadie</h3>
            <p>Preventas, lanzamientos y eventos cerca de ti — sin spam.</p>
          </div>
          <form className={styles.newsletterForm} action="#" method="post">
            <label htmlFor="footer-email" className="sr-only">
              Correo electrónico
            </label>
            <input
              id="footer-email"
              type="email"
              name="email"
              placeholder="tu@correo.com"
              autoComplete="email"
              className={styles.newsletterInput}
            />
            <button type="submit" className={styles.newsletterBtn}>
              Suscribirme
            </button>
          </form>
        </div>
      </section>

      <div className={styles.inner}>
        <div className={styles.brandCol}>
          <p className={styles.brand}>BOLETERA</p>
          <p className={styles.tagline}>Boletos oficiales · Pagos Banorte · Acceso con QR</p>
          <ul className={styles.social}>
            {SOCIAL_LINKS.map((s) => (
              <li key={s.label}>
                <a href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label}>
                  <span aria-hidden="true">{s.icon}</span>
                </a>
              </li>
            ))}
          </ul>
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
          <h3 className={styles.colSubhead}>Legal</h3>
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
