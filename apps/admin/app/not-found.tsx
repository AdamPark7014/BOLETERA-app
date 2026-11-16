import Link from 'next/link';
import { BlackTicketRoot, TicketState } from '@boletera/ui';
import styles from './not-found.module.scss';

/** Dirección que no existe en el panel: una frase y el camino de regreso. */
export default function AdminNotFound() {
  return (
    <BlackTicketRoot density="admin">
      <main className={styles.page}>
        <TicketState
          kind="empty"
          title="No encontramos esta página"
          action={
            <Link href="/dashboard" className={styles.link}>
              Ir al inicio
            </Link>
          }
        />
      </main>
    </BlackTicketRoot>
  );
}
