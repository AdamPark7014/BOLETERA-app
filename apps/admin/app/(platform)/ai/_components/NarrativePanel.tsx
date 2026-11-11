'use client';

import type { AiExecutiveNarrativeResponse } from '@boletera/shared';
import { TicketButton } from '@boletera/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import styles from '../../events/_ticket/frame.module.scss';
import {
  formatCount,
  formatGeneratedAt,
  formatMetricsRange,
  formatMxn,
  formatPercentPoints,
} from '../_lib/format';
import { FigureRow, PanelState } from './PanelState';

type CitedKpi = AiExecutiveNarrativeResponse['kpisCited'][number];

function formatKpi(unit: CitedKpi['unit'], value: number): string {
  switch (unit) {
    case 'mxn':
      return formatMxn(value);
    case 'percent':
      return formatPercentPoints(value);
    case 'ratio':
      return formatPercentPoints(value * 100);
    case 'count':
      return formatCount(value);
  }
}

export function NarrativePanel({
  query,
}: {
  query: UseQueryResult<AiExecutiveNarrativeResponse, Error>;
}) {
  return (
    <PanelState
      data={query.data}
      isPending={query.isPending}
      error={query.error}
      onRetry={() => {
        void query.refetch();
      }}
      isEmpty={(value) => !value.narrative.trim() && value.highlights.length === 0}
      emptyTitle="Sin resumen ejecutivo"
      emptyDescription="Cuando el motor genere una narrativa determinista aparecerá aquí. No se inventan hechos no observados."
    >
      {(data) => (
        <div className={styles.stack}>
          <p className={styles.tertiary}>
            {data.method.name} · {data.language} · {data.currency} · {data.timezone} · generado{' '}
            {formatGeneratedAt(data.generatedAt)}
          </p>
          <p className={styles.tertiary}>
            Periodo {formatMetricsRange(data.dateRange)} · contra{' '}
            {formatMetricsRange(data.comparisonRange)}
          </p>
          <p className={styles.quiet} style={{ color: 'var(--text)' }}>
            {data.narrative}
          </p>
          {data.highlights.length > 0 ? (
            <>
              <p className={styles.rowTitle}>Lo destacado</p>
              <ul className={styles.rows}>
                {data.highlights.map((item) => (
                  <li key={item} className={styles.row}>
                    <p className={styles.quiet}>{item}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {data.watchouts.length > 0 ? (
            <>
              <p className={styles.rowTitle}>A vigilar</p>
              <ul className={styles.rows}>
                {data.watchouts.map((item) => (
                  <li key={item} className={styles.row}>
                    <p className={styles.quiet}>{item}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {data.kpisCited.length > 0 ? (
            <div className={styles.rows}>
              {data.kpisCited.map((kpi) => (
                <FigureRow
                  key={kpi.key}
                  label={kpi.label}
                  meta={`Antes ${formatKpi(kpi.unit, kpi.previousValue)}${
                    kpi.deltaPercent === null
                      ? ''
                      : ` · ${kpi.deltaPercent >= 0 ? '+' : ''}${formatCount(kpi.deltaPercent, 1)} %`
                  }`}
                  value={formatKpi(kpi.unit, kpi.value)}
                />
              ))}
            </div>
          ) : null}
          <p className={styles.tertiary}>
            {data.method.id}: {data.method.rationale}
          </p>
          <div>
            <TicketButton
              variant="ghost"
              onClick={() => {
                void query.refetch();
              }}
            >
              Regenerar resumen
            </TicketButton>
          </div>
        </div>
      )}
    </PanelState>
  );
}
