import Link from 'next/link';
import { Badge, Card, CardFooter, CardHeader, formatNumber } from '@boletera/ui';
import type { ConsumptionRow } from '../_lib/consumption';
import styles from '../platform.module.scss';

export interface ConsumptionCardProps {
  rows: readonly ConsumptionRow[];
}

/**
 * Consumo tal cual lo reporta la API. No hay barras porque el contrato no
 * devuelve cupos: sin denominador no hay progreso que mostrar.
 */
export function ConsumptionCard({ rows }: ConsumptionCardProps) {
  return (
    <Card variant="outline" padding="md" role="group" aria-label="Consumo de la organización">
      <CardHeader
        as="h3"
        title="Consumo de la organización"
        description="Volumen real acumulado por el tenant en cada capacidad medible."
      />

      <ul className={styles.consumptionList}>
        {rows.map((row) => (
          <li key={row.key} className={styles.consumptionRow}>
            <div className={styles.consumptionText}>
              <div className={styles.consumptionHead}>
                <span className={styles.consumptionLabel}>{row.label}</span>
                <Badge tone="neutral" variant="outline" size="sm">
                  {row.scopeLabel}
                </Badge>
              </div>
              <p className={styles.consumptionHint}>{row.description}</p>
            </div>

            <div className={styles.consumptionValue}>
              <strong>{formatNumber(row.value)}</strong>
              <Link className={styles.cta} href={row.cta.href}>
                {row.cta.label}
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </li>
        ))}
      </ul>

      <CardFooter className={styles.cardNote}>
        <p>
          Tu plan no expone cupos ni topes para estos contadores, así que no verás barras de
          límite: solo el consumo real. Si necesitas un tope contratado, se define fuera de esta
          vista con tu ejecutivo.
        </p>
      </CardFooter>
    </Card>
  );
}
