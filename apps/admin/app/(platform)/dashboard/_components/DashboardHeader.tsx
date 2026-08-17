'use client';

import Link from 'next/link';
import { Badge, Button, PageHeader, SegmentedControl, StatusDot } from '@boletera/ui';
import { formatRelative } from '../format';
import { RANGE_SEGMENTS, type DashboardRange, type DashboardRangeKey } from '../range';
import styles from '../dashboard.module.scss';

type DashboardHeaderProps = {
  range: DashboardRange;
  onRangeChange: (key: DashboardRangeKey) => void;
  /** Instante en que la API generó los agregados. */
  generatedAt: string | null;
  isRefreshing: boolean;
  onRefresh: () => void;
};

const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function DashboardHeader({
  range,
  onRangeChange,
  generatedAt,
  isRefreshing,
  onRefresh,
}: DashboardHeaderProps) {
  return (
    <PageHeader
      className={styles.header}
      eyebrow={
        <span className={styles.eyebrowRow}>
          <StatusDot tone="success" size="sm" pulse label="Dashboard ejecutivo" />
          <Badge tone="neutral" variant="outline" size="sm">
            MXN · Ciudad de México
          </Badge>
        </span>
      }
      title="Operación en vivo"
      description={`${range.label} · ingresos, ritmo de venta y alertas accionables con granularidad ${range.granularityLabel}.`}
      actions={
        <div className={styles.headerActions}>
          <SegmentedControl
            label="Rango temporal"
            size="sm"
            options={RANGE_SEGMENTS}
            value={range.key}
            onValueChange={onRangeChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            iconLeft={<RefreshIcon />}
            loading={isRefreshing}
            loadingLabel="Actualizando"
            onClick={onRefresh}
          >
            Actualizar
          </Button>
          <Link href="/events/new" className={styles.primaryLink}>
            Crear evento
          </Link>
        </div>
      }
    >
      <p className={styles.freshness} role="status" aria-live="polite">
        {generatedAt ? (
          <>
            Datos generados <time dateTime={generatedAt}>{formatRelative(generatedAt)}</time> ·
            comparativo {range.comparisonLabel.replace(/^vs\.\s*/, '')}
          </>
        ) : (
          'Preparando agregados del periodo…'
        )}
      </p>
    </PageHeader>
  );
}
