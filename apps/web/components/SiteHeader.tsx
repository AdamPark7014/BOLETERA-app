'use client';

import Link from 'next/link';
import styles from './SiteHeader.module.scss';

type SiteHeaderProps = {
  theme?: 'light' | 'dark';
};

/** Wordmark de la compra. La cuenta es un enlace de texto, no un segundo primario. */
export function SiteHeader(_props: SiteHeaderProps) {
  return (
    <header className={styles.purchaseBar}>
      <div className={styles.purchaseInner}>
        <Link href="/" className={styles.wordmark}>
          Black Ticket
        </Link>
        <Link href="/cuenta" className={styles.account}>
          Cuenta
        </Link>
      </div>
    </header>
  );
}
