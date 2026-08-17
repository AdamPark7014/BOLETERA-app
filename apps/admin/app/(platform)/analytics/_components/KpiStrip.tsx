'use client';

import type { MetricsKpi } from '@boletera/shared';
import { KpiCard, type KpiTone } from '@boletera/ui/src/components/KpiCard';
import { formatKpi, kpiHint, kpiTrend } from '../_lib/format';
import styles from '../analytics.module.scss';

export interface KpiStripItem {
  kpi: MetricsKpi;
  tone?: KpiTone;
  invertDelta?: boolean;
  trend?: readonly number[];
  unitLabel?: string;
}

export function KpiStrip({
  items,
  comparisonLabel,
  loading = false,
}: {
  items: readonly KpiStripItem[];
  comparisonLabel: string;
  loading?: boolean;
}) {
  return (
    <div className={styles.kpiGrid} aria-label="Indicadores clave">
      {(loading
        ? Array.from({ length: Math.max(items.length, 4) }, (_unused, index) => ({
            key: `skeleton-${index}`,
            loading: true as const,
          }))
        : items.map((item) => ({
            key: item.kpi.key,
            loading: false as const,
            item,
          }))
      ).map((entry) =>
        entry.loading ? (
          <KpiCard key={entry.key} label="Cargando" value="—" loading />
        ) : (
          <KpiCard
            key={entry.key}
            label={entry.item.kpi.label}
            value={formatKpi(entry.item.kpi)}
            unit={entry.item.unitLabel}
            delta={kpiTrend(entry.item.kpi)}
            deltaLabel={comparisonLabel}
            invertDelta={entry.item.invertDelta}
            tone={entry.item.tone}
            trend={entry.item.trend}
            hint={kpiHint(entry.item.kpi, comparisonLabel)}
          />
        ),
      )}
    </div>
  );
}
