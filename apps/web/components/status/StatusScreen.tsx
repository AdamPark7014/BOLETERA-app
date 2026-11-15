import Link from 'next/link';
import type { ReactNode } from 'react';
import { StageArt } from '@boletera/ui';
import styles from './StatusScreen.module.scss';

type StatusScreenProps = {
  kicker: string;
  title: string;
  body: string;
  /** Acción principal; por omisión vuelve a la cartelera. */
  action?: ReactNode;
};

/** Pantalla de estado (404, error) en el lenguaje de la maqueta: luces de escenario y titular. */
export function StatusScreen({ kicker, title, body, action }: StatusScreenProps) {
  return (
    <main id="contenido" tabIndex={-1} className={styles.wrap}>
      <section className={styles.hero}>
        <StageArt seed={kicker} className={styles.art} />
        <div className={styles.shade} />
        <div className={styles.copy}>
          <span className={styles.kicker}>{kicker}</span>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.body}>{body}</p>
          <div className={styles.actions}>
            {action}
            <Link href="/" className={action ? styles.secondary : styles.primary}>
              Ir a la cartelera
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
