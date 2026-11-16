import Link from 'next/link';
import { TicketState } from '@boletera/ui';
import styles from './frame.module.scss';

/** «No encontrado», igual en todo el panel: una frase y el camino de regreso. */
export function NotFound({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <section role="alert">
      <TicketState
        kind="empty"
        align="start"
        title={title}
        body="Puede que se haya eliminado o que el enlace esté mal."
        action={
          <Link href={href} className={styles.ghostLink}>
            {linkLabel}
          </Link>
        }
      />
    </section>
  );
}
