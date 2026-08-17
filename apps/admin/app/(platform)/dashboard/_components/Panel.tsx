'use client';

import type { ReactNode } from 'react';
import { Button, EmptyState, Skeleton } from '@boletera/ui';
import { errorMessage } from '../format';
import styles from '../dashboard.module.scss';

type PanelProps = {
  /** Id del encabezado; enlaza la sección con su título. */
  headingId: string;
  title: string;
  description?: ReactNode;
  /** Controles alineados a la derecha del título. */
  actions?: ReactNode;
  /** Pie discreto bajo el contenido. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** Contenedor estándar de cada bloque del dashboard. */
export function Panel({
  headingId,
  title,
  description,
  actions,
  footer,
  className,
  children,
}: PanelProps) {
  return (
    <section
      className={className ? `${styles.panel} ${className}` : styles.panel}
      aria-labelledby={headingId}
    >
      <header className={styles.panelHead}>
        <div className={styles.panelHeadText}>
          <h2 id={headingId} className={styles.panelTitle}>
            {title}
          </h2>
          {description ? <p className={styles.panelDescription}>{description}</p> : null}
        </div>
        {actions ? <div className={styles.panelActions}>{actions}</div> : null}
      </header>

      <div className={styles.panelBody}>{children}</div>

      {footer ? <footer className={styles.panelFooter}>{footer}</footer> : null}
    </section>
  );
}

/** Esqueleto de lista: filas escalonadas con la misma altura que el contenido real. */
export function ListSkeleton({ rows = 3, height = 56 }: { rows?: number; height?: number }) {
  return (
    <div className={styles.listSkeleton} role="status" aria-busy="true">
      {Array.from({ length: rows }, (_unused, index) => (
        <Skeleton key={index} height={height} radius={10} delay={index * 80} />
      ))}
      <span className={styles.srOnly}>Cargando…</span>
    </div>
  );
}

/** Estado de error de un panel, con reintento local. */
export function PanelError({
  error,
  title = 'No se pudo cargar este bloque',
  fallback = 'Revisa la conexión o vuelve a intentarlo en unos segundos.',
  onRetry,
}: {
  error: unknown;
  title?: string;
  fallback?: string;
  onRetry: () => void;
}) {
  return (
    <EmptyState
      size="sm"
      tone="danger"
      illustration="error"
      title={title}
      description={errorMessage(error, fallback)}
      action={
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Reintentar
        </Button>
      }
    />
  );
}
