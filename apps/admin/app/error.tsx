'use client';

import { useEffect } from 'react';
import { BlackTicketRoot, TicketButton, TicketState } from '@boletera/ui';
import styles from './not-found.module.scss';

/** Fallo no controlado de una pantalla: sin texto técnico, con un solo botón. */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Error no controlado en el panel administrativo', error);
  }, [error]);

  return (
    <BlackTicketRoot density="admin">
      <main className={styles.page}>
        <TicketState
          kind="error"
          title="No pudimos mostrar esta pantalla"
          action={<TicketButton onClick={reset}>Reintentar</TicketButton>}
        />
      </main>
    </BlackTicketRoot>
  );
}
