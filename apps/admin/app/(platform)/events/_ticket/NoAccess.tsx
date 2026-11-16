import Link from 'next/link';
import { TicketState } from '@boletera/ui';
import styles from './frame.module.scss';

/** Estado «sin permiso», el mismo en todo el panel: una frase y una salida. */
export function NoAccess({ href = '/dashboard' }: { href?: string }) {
  return (
    <TicketState
      kind="empty"
      align="start"
      title="No tienes acceso a esta pantalla"
      body="Pídelo a quien administra tu organización."
      action={
        <Link href={href} className={styles.ghostLink}>
          Ir al inicio
        </Link>
      }
    />
  );
}
