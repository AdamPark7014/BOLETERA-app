'use client';

import { KpiCard } from '@boletera/ui';
import {
  formatCount,
  formatLatency,
  formatPercentPoints,
  formatRate,
  formatThroughput,
} from './format';
import type { ScanStats } from './types';
import styles from './scanner.module.scss';

type Props = {
  stats: ScanStats;
  ticketsCheckedIn: number | null;
  ticketsNoShow: number | null;
  noShowRate: number | null;
  loading: boolean;
  degraded: boolean;
};

export function LiveKpis({
  stats,
  ticketsCheckedIn,
  ticketsNoShow,
  noShowRate,
  loading,
  degraded,
}: Props) {
  const platformHint = degraded
    ? 'Datos de plataforma no disponibles'
    : 'Agregado de plataforma';

  return (
    <section className={styles.kpiGrid} aria-label="Indicadores en vivo">
      <KpiCard
        label="Throughput"
        value={formatThroughput(stats.throughputPerMin)}
        unit="/ min"
        tone="accent"
        hint={`Pico sesión ${formatThroughput(stats.peakPerMin)}/min · estación`}
        loading={false}
      />
      <KpiCard
        label="Aprobación"
        value={formatRate(stats.approvalRate)}
        tone={
          stats.approvalRate === null
            ? 'neutral'
            : stats.approvalRate >= 0.9
              ? 'success'
              : stats.approvalRate >= 0.75
                ? 'warning'
                : 'danger'
        }
        hint={`${formatCount(stats.approved)} ok · ${formatCount(stats.rejected)} rechazo`}
        loading={false}
      />
      <KpiCard
        label="Check-ins"
        value={ticketsCheckedIn === null ? '—' : formatCount(ticketsCheckedIn)}
        tone="info"
        hint={platformHint}
        loading={loading && ticketsCheckedIn === null}
      />
      <KpiCard
        label="No-show"
        value={
          noShowRate === null
            ? '—'
            : formatPercentPoints(noShowRate)
        }
        tone={
          noShowRate === null
            ? 'neutral'
            : noShowRate > 35
              ? 'danger'
              : noShowRate > 20
                ? 'warning'
                : 'success'
        }
        invertDelta
        hint={
          ticketsNoShow === null
            ? platformHint
            : `${formatCount(ticketsNoShow)} boletos sin check-in`
        }
        loading={loading && noShowRate === null}
      />
      <KpiCard
        label="Cola offline"
        value={formatCount(stats.queued)}
        tone={stats.queued > 0 ? 'warning' : 'neutral'}
        hint={stats.queued > 0 ? 'Pendientes de sincronizar' : 'Sin pendientes'}
      />
      <KpiCard
        label="Latencia mediana"
        value={formatLatency(stats.medianLatencyMs)}
        tone="neutral"
        hint={`${formatCount(stats.lastHourCount)} escaneos en la última hora`}
      />
    </section>
  );
}
