'use client';

import type { ReactNode } from 'react';
import { KpiCard, type KpiTone } from '@boletera/ui';
import type { ExecutiveSummaryMetrics } from '@boletera/shared';
import { formatKpiScalar, formatKpiValue, toDeltaRatio } from '../format';
import { KPI_ORDER, type KpiKey } from '../_lib/derive';
import styles from '../dashboard.module.scss';

type KpiStripProps = {
  kpis: ExecutiveSummaryMetrics['kpis'] | undefined;
  trends: Record<KpiKey, readonly number[]>;
  comparisonLabel: string;
  loading: boolean;
};

const Glyph = ({ d }: { d: string }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d={d} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const KPI_PRESENTATION: Record<KpiKey, { tone: KpiTone; icon: ReactNode }> = {
  grossRevenue: {
    tone: 'accent',
    icon: <Glyph d="M12 3v18M8 7h6a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h7" />,
  },
  netRevenue: {
    tone: 'neutral',
    icon: <Glyph d="M4 18h16M6 14l4-5 3 3 5-7" />,
  },
  ordersCompleted: {
    tone: 'info',
    icon: <Glyph d="M6 4h12l2 6-8 10L4 10z M4 10h16" />,
  },
  ticketsSold: {
    tone: 'neutral',
    icon: <Glyph d="M4 8a2 2 0 0 0 0 8v2h16v-2a2 2 0 0 1 0-8V6H4z M10 6v12" />,
  },
  averageTicketPrice: {
    tone: 'neutral',
    icon: <Glyph d="M4 12h16M12 4v16M7 8h3M14 16h3" />,
  },
  conversionRate: {
    tone: 'success',
    icon: <Glyph d="M3 5h18l-7 8v6l-4-2v-4z" />,
  },
};

/** Tira superior de indicadores clave con delta, comparativo y sparkline. */
export function KpiStrip({ kpis, trends, comparisonLabel, loading }: KpiStripProps) {
  return (
    <section className={styles.kpiGrid} aria-label="Indicadores clave del periodo">
      {KPI_ORDER.map((key) => {
        const kpi = kpis?.[key];
        const presentation = KPI_PRESENTATION[key];

        if (loading || !kpi) {
          return <KpiCard key={key} label="" value="" loading tone={presentation.tone} />;
        }

        const trend = trends[key];
        return (
          <KpiCard
            key={key}
            label={kpi.label}
            value={formatKpiValue(kpi)}
            delta={toDeltaRatio(kpi.deltaPercent)}
            deltaLabel={comparisonLabel}
            trend={trend.length > 1 ? trend : undefined}
            tone={presentation.tone}
            icon={presentation.icon}
            hint={`Periodo previo: ${formatKpiScalar(kpi.unit, kpi.previousValue)}`}
          />
        );
      })}
    </section>
  );
}
