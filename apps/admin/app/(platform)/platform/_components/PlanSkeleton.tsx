import { Card, Skeleton, SkeletonText } from '@boletera/ui';
import styles from '../platform.module.scss';

const KPI_SLOTS = ['activas', 'sin-uso', 'inactivas', 'entregas'] as const;

/** Carga de la pantalla completa: se anuncia una sola vez, no bloque por bloque. */
export function PlanSkeleton() {
  return (
    <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
      <span className={styles.srOnly}>Cargando tu plan contratado…</span>

      <div className={styles.kpiGrid} aria-hidden="true">
        {KPI_SLOTS.map((slot, index) => (
          <Card key={slot} variant="outline" padding="md" className={styles.kpiSkeleton}>
            <Skeleton shape="text" width="54%" height={11} delay={index * 60} />
            <Skeleton shape="text" width="36%" height={26} delay={index * 60 + 80} />
            <Skeleton shape="text" width="70%" height={11} delay={index * 60 + 140} />
          </Card>
        ))}
      </div>

      <div className={styles.layout} aria-hidden="true">
        <div className={styles.column}>
          <Card variant="outline" padding="md">
            <Skeleton shape="text" width="34%" height={16} />
            <SkeletonText lines={4} />
          </Card>
          <Card variant="outline" padding="md">
            <Skeleton shape="text" width="42%" height={16} />
            <SkeletonText lines={6} />
          </Card>
        </div>
        <div className={styles.column}>
          <Card variant="outline" padding="md">
            <Skeleton shape="text" width="48%" height={16} />
            <SkeletonText lines={5} />
          </Card>
        </div>
      </div>
    </div>
  );
}
