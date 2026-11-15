import type { ReactNode } from 'react';
import styles from './PageTitle.module.scss';

export interface PageTitleProps {
  /** Titular de la página (Archivo condensado, mayúsculas). Sin eyebrow. */
  title: string;
  /** Opcional: un dato corto junto al titular (cifra o etiqueta: «12 eventos»). */
  meta?: ReactNode;
  /** Opcional: acciones de la página, a la derecha (una principal como mucho). */
  actions?: ReactNode;
  /** Nivel del encabezado; por omisión h1. */
  as?: 'h1' | 'h2';
  className?: string;
}

/** Titular único de página para web, admin y taquilla. */
export function PageTitle({ title, meta, actions, as = 'h1', className }: PageTitleProps) {
  const Heading = as;
  return (
    <header className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <div className={styles.titles}>
        <Heading className={styles.title}>{title}</Heading>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
