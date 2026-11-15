import Link from 'next/link';
import { BrandLogo } from '@boletera/ui';
import styles from './SiteFooter.module.scss';

/** Pie de la maqueta: logo dorado, enlaces y métodos de pago reales. */
export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <h2 className="sr-only">Pie de página</h2>
      <div className={styles.inner}>
        <Link href="/" className={styles.logo} aria-label="Black Ticket, inicio">
          <BrandLogo tone="gold" size={32} />
        </Link>
        <nav className={styles.nav} aria-label="Enlaces del sitio">
          <Link href="/ayuda">Ayuda</Link>
          <Link href="/venues">Recintos</Link>
          <Link href="/ciudades">Ciudades</Link>
          <Link href="/resale">Reventa</Link>
          <Link href="/membresias">Membresías</Link>
          <Link href="/terminos">Términos</Link>
          <Link href="/privacidad">Privacidad</Link>
        </nav>
      </div>
      <p className={styles.copy}>© {new Date().getFullYear()} Black Ticket · Boletos oficiales</p>
    </footer>
  );
}
