import { Card, Skeleton, SkeletonCard, SkeletonText } from '@boletera/ui';
import styles from '../crm.module.scss';

/** Skeleton premium del cockpit CRM (KPIs + layout dual). */
export function CrmSkeleton() {
  return (
    <div
      className={styles.skeleton}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className={styles.srOnly}>Cargando CRM…</span>
      <div className={styles.kpiGrid} aria-hidden="true">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </div>
      <div className={styles.layout} aria-hidden="true">
        <div className={styles.mainCol}>
          <Card padding="md">
            <Skeleton shape="text" width="40%" height={16} />
            <div className={styles.segmentGrid} style={{ marginTop: '0.75rem' }}>
              <Skeleton height={88} radius={12} />
              <Skeleton height={88} radius={12} delay={60} />
              <Skeleton height={88} radius={12} delay={120} />
              <Skeleton height={88} radius={12} delay={180} />
              <Skeleton height={88} radius={12} delay={240} />
            </div>
          </Card>
          <Card padding="md">
            <Skeleton height={40} radius={10} />
            <div style={{ marginTop: '0.75rem' }}>
              <SkeletonText lines={8} />
            </div>
          </Card>
        </div>
        <div className={styles.sideCol}>
          <Card padding="md">
            <SkeletonText lines={6} />
          </Card>
          <Card padding="md">
            <SkeletonText lines={5} />
          </Card>
          <Card padding="md">
            <SkeletonText lines={4} />
          </Card>
        </div>
      </div>
    </div>
  );
}
