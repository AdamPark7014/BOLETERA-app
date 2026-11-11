'use client';

import type { ReactNode } from 'react';
import { BlackTicketRoot } from '@boletera/ui';
import styles from '../login.module.scss';

/**
 * Lienzo de las pantallas de acceso: tinta, marca en texto y una columna.
 * Es el mismo patrón que el acceso de taquilla, con la densidad del panel.
 */
export function AuthShell({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <BlackTicketRoot density="admin">
      <main className={styles.page}>
        <header className={styles.bar}>
          <p className={styles.wordmark}>Black Ticket</p>
          <p className={styles.barNote}>Panel de organizador</p>
        </header>
        <div className={styles.column}>
          <header className={styles.head}>
            <h1>{title}</h1>
            {lead ? <p className={styles.quiet}>{lead}</p> : null}
          </header>
          {children}
        </div>
      </main>
    </BlackTicketRoot>
  );
}

/** Aviso de una línea. Los errores se anuncian; lo demás, sin interrumpir. */
export function StatusBanner({
  tone,
  id,
  children,
}: {
  tone: 'error' | 'success' | 'info';
  id?: string;
  children: ReactNode;
}) {
  const className =
    tone === 'error' ? styles.danger : tone === 'success' ? styles.success : styles.quiet;
  return (
    <p id={id} className={className} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
