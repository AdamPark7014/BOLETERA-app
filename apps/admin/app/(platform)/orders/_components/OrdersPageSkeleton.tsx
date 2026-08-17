'use client';

import styles from '../orders.module.scss';

/** Premium loading shell shared by list Suspense and detail pending. */
export function OrdersPageSkeleton({
  variant = 'list',
}: {
  variant?: 'list' | 'detail';
}) {
  return (
    <div
      className={styles.pageShell}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className={styles.visuallyHidden}>Cargando centro de órdenes…</span>
      <div className={styles.shellHeader}>
        <div className={styles.shellLineShort} />
        <div className={styles.shellLineWide} />
        <div className={styles.shellLineMed} />
      </div>

      {variant === 'list' ? (
        <>
          <div className={styles.shellKpis} aria-hidden="true">
            <div className={styles.shellCard} />
            <div className={styles.shellCard} />
            <div className={styles.shellCard} />
            <div className={styles.shellCard} />
          </div>
          <div className={styles.trendsRow} aria-hidden="true">
            <div className={styles.shellBlock} />
            <div className={styles.shellBlock} />
            <div className={styles.shellBlock} />
          </div>
          <div className={styles.shellBlock} style={{ height: 320 }} aria-hidden="true" />
        </>
      ) : (
        <div className={styles.detailLayout} aria-hidden="true">
          <div className={styles.detailMain}>
            <div className={styles.shellBlock} />
            <div className={styles.shellBlock} style={{ height: 180 }} />
          </div>
          <div className={styles.detailSide}>
            <div className={styles.shellBlock} style={{ height: 160 }} />
            <div className={styles.shellBlock} style={{ height: 200 }} />
          </div>
        </div>
      )}
    </div>
  );
}
