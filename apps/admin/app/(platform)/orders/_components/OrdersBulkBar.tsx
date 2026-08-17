'use client';

import { Button } from '@boletera/ui';
import styles from '../orders.module.scss';

type OrdersBulkBarProps = {
  count: number;
  canResend: boolean;
  canCancel: boolean;
  busy: boolean;
  onResend: () => void;
  onCancel: () => void;
  onClear: () => void;
};

export function OrdersBulkBar({
  count,
  canResend,
  canCancel,
  busy,
  onResend,
  onCancel,
  onClear,
}: OrdersBulkBarProps) {
  if (count === 0) return null;

  return (
    <div className={styles.bulkBar} role="region" aria-label="Acciones masivas">
      <p className={styles.bulkCount}>
        <strong>{count}</strong> {count === 1 ? 'orden seleccionada' : 'órdenes seleccionadas'}
      </p>
      <div className={styles.bulkActions}>
        <Button
          variant="secondary"
          size="sm"
          disabled={!canResend || busy}
          onClick={onResend}
        >
          Reenviar email
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={!canCancel || busy}
          onClick={onCancel}
        >
          Cancelar pendientes
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClear}>
          Limpiar
        </Button>
      </div>
    </div>
  );
}
