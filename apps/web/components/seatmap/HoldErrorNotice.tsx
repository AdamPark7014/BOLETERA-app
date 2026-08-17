'use client';

import type { InventoryError } from './errors';
import styles from './HoldErrorNotice.module.scss';

/**
 * Aviso de fallo al apartar boletos.
 *
 * Vive aquí (y no en `event.module.scss`) porque ese archivo de estilos lo
 * comparten otras vistas que están tocando otros agentes; así el aviso viaja
 * completo —marcado + estilos— dentro del subsistema del mapa.
 *
 * Es `role="alert"`: un 409 durante la compra tiene que interrumpir, no
 * esperar a que el usuario mire hacia abajo.
 */
export function HoldErrorNotice({
  error,
  onRetry,
  onDismiss,
}: {
  error: InventoryError;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className={styles.notice} role="alert">
      <p className={styles.text}>{error.message}</p>
      <div className={styles.actions}>
        {onRetry && error.kind !== 'hold-limit' && (
          <button type="button" className={styles.retry} onClick={onRetry}>
            Reintentar
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            className={styles.dismiss}
            onClick={onDismiss}
            aria-label="Descartar aviso"
          >
            Entendido
          </button>
        )}
      </div>
    </div>
  );
}
