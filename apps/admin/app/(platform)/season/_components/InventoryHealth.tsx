'use client';

import { Badge, EmptyState } from '@boletera/ui';
import { formatCount, formatRatio } from '../_lib/money';
import type { InventoryRow } from '../_lib/passes';
import styles from '../season.module.scss';

type InventoryHealthProps = {
  rows: readonly InventoryRow[];
  loading: boolean;
};

const LEVEL_LABEL: Record<InventoryRow['level'], string> = {
  agotado: 'Agotado',
  critico: 'Crítico',
  estable: 'Estable',
};

const BAR_CLASS: Record<InventoryRow['level'], string> = {
  agotado: styles.bar_agotado,
  critico: styles.bar_critico,
  estable: styles.bar_estable,
};

export function InventoryHealth({ rows, loading }: InventoryHealthProps) {
  return (
    <aside className={styles.card} aria-label="Salud de inventario">
      <div className={styles.cardHead}>
        <div>
          <h2>Salud de inventario</h2>
          <p>Prioriza cupos con presión de demanda</p>
        </div>
      </div>

      {loading ? (
        <p className={styles.muted} role="status">
          Evaluando inventario…
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Sin abonos activos"
          description="Activa o crea un abono para ver la presión de cupo."
          illustration="inbox"
          size="sm"
        />
      ) : (
        <ul className={styles.inventoryList}>
          {rows.map((row) => (
            <li key={row.id}>
              <div>
                <strong>{row.name}</strong>
                <small>
                  {formatCount(row.left)} libres · {formatRatio(row.pressure)} ocupado
                </small>
                <div
                  className={styles.bar}
                  role="meter"
                  aria-label={`Ocupación ${Math.round(row.pressure * 100)}%`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(row.pressure * 100)}
                >
                  <span
                    className={BAR_CLASS[row.level]}
                    style={{ width: `${Math.min(row.pressure * 100, 100)}%` }}
                  />
                </div>
              </div>
              <Badge tone={row.tone} variant="soft" size="sm" dot>
                {LEVEL_LABEL[row.level]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
