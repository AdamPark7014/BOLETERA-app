import Link from 'next/link';
import { BrandLogo } from '@boletera/ui';
import styles from './SiteFooter.module.scss';

/** Pie ordenado: marca, ayuda, legales y descubrimiento. */
export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <h2 className="sr-only">Pie de página</h2>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <Link href="/" className={styles.logo} aria-label="Black Ticket, inicio">
            <BrandLogo tone="white" size={32} />
          </Link>
          <p className={styles.tagline}>Boletos oficiales. Precio final con cargos e IVA.</p>
        </div>
        <nav className={styles.nav} aria-label="Ayuda">
          <p className={styles.navTitle}>Ayuda</p>
          <Link href="/ayuda">Centro de ayuda</Link>
          <Link href="/cuenta">Mis boletos</Link>
          <Link href="/resale">Reventa oficial</Link>
        </nav>
        <nav className={styles.nav} aria-label="Explorar">
          <p className={styles.navTitle}>Explorar</p>
          <Link href="/ciudades">Ciudades</Link>
          <Link href="/venues">Recintos</Link>
          <Link href="/membresias">Membresías</Link>
        </nav>
        <nav className={styles.nav} aria-label="Legal">
          <p className={styles.navTitle}>Legal</p>
          <Link href="/terminos">Términos</Link>
          <Link href="/privacidad">Privacidad</Link>
        </nav>
      </div>
      <p className={styles.copy}>© {new Date().getFullYear()} Black Ticket · Boletos oficiales</p>
    </footer>
  );
}
