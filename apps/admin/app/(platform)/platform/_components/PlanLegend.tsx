import { Badge, Card, CardHeader, ProgressRing, formatPercent } from '@boletera/ui';
import type { CapabilitySummary } from '../_lib/catalog';
import { ratioOf } from '../_lib/progress';
import styles from '../platform.module.scss';

export interface PlanLegendProps {
  summary: CapabilitySummary;
}

/** Explica los tres estados con los que se etiqueta cada capacidad del plan. */
export function PlanLegend({ summary }: PlanLegendProps) {
  const adoption = ratioOf(summary.active, summary.total);

  return (
    <Card variant="outline" padding="md" role="group" aria-label="Cómo leer tu plan">
      <CardHeader
        as="h3"
        title="Cómo leer tu plan"
        description="Cada capacidad se etiqueta según lo que la API reporta hoy para tu organización."
      />

      <div className={styles.legendBody}>
        {adoption === null ? null : (
          <ProgressRing
            value={summary.active}
            max={summary.total}
            size={96}
            tone={summary.active === summary.total ? 'success' : 'accent'}
            label={`Capacidades activas: ${summary.active} de ${summary.total}`}
          >
            {formatPercent(adoption, 0)}
          </ProgressRing>
        )}

        <dl className={styles.legendList}>
          <div className={styles.legendItem}>
            <dt>
              <Badge tone="success" variant="soft" dot>
                Activa
              </Badge>
            </dt>
            <dd>Operando ahora mismo. Nada que hacer de tu lado.</dd>
          </div>
          <div className={styles.legendItem}>
            <dt>
              <Badge tone="warning" variant="soft" dot>
                Contratada sin uso
              </Badge>
            </dt>
            <dd>Está incluida y se enciende sola con el primer uso real.</dd>
          </div>
          <div className={styles.legendItem}>
            <dt>
              <Badge tone="neutral" variant="soft" dot>
                Desactivada
              </Badge>
            </dt>
            <dd>Depende de un ajuste de la organización o no está habilitada.</dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}
