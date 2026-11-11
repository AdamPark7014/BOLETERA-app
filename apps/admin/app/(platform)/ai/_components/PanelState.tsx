'use client';

import type { ReactNode } from 'react';
import { TicketButton } from '@boletera/ui';
import styles from '../../events/_ticket/frame.module.scss';
import {
  aiErrorMessage,
  formatAiReason,
  isAiServiceUnavailable,
  readAiReason,
} from '../_lib/status';

/**
 * Estados del panel de IA en Black Ticket: cargando, motor no conectado, error y vacío.
 *
 * El texto de «no conectado» es deliberadamente explícito: sin endpoint activo
 * se muestra un vacío honesto, nunca predicciones inventadas para que la
 * pantalla parezca llena.
 */

export function PanelSkeleton({ label = 'Cargando.' }: { label?: string }) {
  return (
    <p className={styles.quiet} role="status" aria-live="polite">
      {label}
    </p>
  );
}

export function PanelUnavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className={styles.stack}>
      <p className={styles.rowTitle}>Motor de IA no conectado</p>
      <p className={styles.quiet}>
        Este panel consulta un endpoint del ai-engine. Mientras no responda, no se muestran
        predicciones ni resúmenes inventados.
      </p>
      {onRetry ? (
        <div>
          <TicketButton variant="ghost" onClick={onRetry}>
            Reintentar
          </TicketButton>
        </div>
      ) : null}
    </div>
  );
}

export function PanelError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  // Servicio no conectado ≠ error: el primero se explica, el segundo se reintenta.
  if (isAiServiceUnavailable(error)) return <PanelUnavailable onRetry={onRetry} />;
  return (
    <div className={styles.stack}>
      <p className={styles.danger} role="alert">
        {aiErrorMessage(error)}
      </p>
      {onRetry ? (
        <div>
          <TicketButton variant="ghost" onClick={onRetry}>
            Reintentar
          </TicketButton>
        </div>
      ) : null}
    </div>
  );
}

export function PanelEmpty({
  title,
  description,
  reason,
}: {
  title: string;
  description: string;
  /** Motivo concreto devuelto por el API (`reason`), si lo hay. */
  reason?: string | null;
}) {
  return (
    <div className={styles.stack}>
      <p className={styles.rowTitle}>{title}</p>
      {reason ? <p className={styles.quiet}>{formatAiReason(reason)}</p> : null}
      <p className={reason ? styles.tertiary : styles.quiet}>{description}</p>
    </div>
  );
}

export function PanelState<T>({
  data,
  isPending,
  error,
  onRetry,
  isEmpty,
  emptyTitle,
  emptyDescription,
  children,
}: {
  data: T | undefined;
  isPending: boolean;
  error: unknown;
  onRetry?: () => void;
  isEmpty: (value: T) => boolean;
  emptyTitle: string;
  emptyDescription: string;
  children: (value: T) => ReactNode;
}) {
  if (error) return <PanelError error={error} onRetry={onRetry} />;
  if (isPending) return <PanelSkeleton />;
  if (data === undefined || isEmpty(data))
    return (
      <PanelEmpty title={emptyTitle} description={emptyDescription} reason={readAiReason(data)} />
    );
  return <>{children(data)}</>;
}

/** Fila etiqueta / valor tabular, para las cifras que antes eran tarjetas o gráficas. */
export function FigureRow({ label, meta, value }: { label: string; meta?: string; value: string }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <p className={styles.rowTitle}>{label}</p>
        {meta ? <p className={styles.rowMeta}>{meta}</p> : null}
      </div>
      <span />
      <p className={styles.figure}>{value}</p>
    </div>
  );
}
