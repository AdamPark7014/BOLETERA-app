'use client';

import type { AiExecutiveNarrativeResponse } from '@boletera/shared';
import { Badge, Button } from '@boletera/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  formatCount,
  formatGeneratedAt,
  formatMetricsRange,
  formatMxn,
  formatPercentPoints,
} from '../_lib/format';
import styles from '../ai.module.scss';
import { PanelState } from './PanelState';

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
      emptyHints={['GET /ai/summaries/executive', 'Idioma es-MX · moneda MXN']}
    >
      {(data) => (
        <div className={styles.narrative}>
          <div className={styles.metaRow}>
            <Badge tone="info" variant="outline">
              {data.method.name}
            </Badge>
            <Badge tone="neutral" variant="outline">
              {data.language} · {data.currency}
            </Badge>
            <Badge tone="neutral" variant="outline">
              {data.timezone}
            </Badge>
            <span className={styles.muted}>
              Generado {formatGeneratedAt(data.generatedAt)}
            </span>
          </div>

          <p className={styles.muted}>
            Periodo {formatMetricsRange(data.dateRange)} · vs{' '}
            {formatMetricsRange(data.comparisonRange)}
          </p>

          <p className={styles.narrativeBody}>{data.narrative}</p>

          {data.highlights.length > 0 ? (
            <div className={styles.bulletBlock}>
              <h3 className={styles.blockTitle}>Highlights</h3>
              <ul className={styles.bullets}>
                {data.highlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.watchouts.length > 0 ? (
            <div className={styles.bulletBlock}>
              <h3 className={styles.blockTitle}>Watchouts</h3>
              <ul className={styles.bulletsWarn}>
                {data.watchouts.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.kpisCited.length > 0 ? (
            <div className={styles.kpiCited}>
              {data.kpisCited.map((kpi) => (
                <article key={kpi.key} className={styles.kpiCitedCard}>
                  <span>{kpi.label}</span>
                  <strong>{formatKpi(kpi.unit, kpi.value)}</strong>
                  <small>
                    Prev. {formatKpi(kpi.unit, kpi.previousValue)}
                    {kpi.deltaPercent === null
                      ? ''
                      : ` · ${kpi.deltaPercent >= 0 ? '+' : ''}${formatCount(kpi.deltaPercent, 1)} %`}
                  </small>
                </article>
              ))}
            </div>
          ) : null}

          <p className={styles.methodNote}>
            {data.method.id}: {data.method.rationale}
          </p>

          <div className={styles.inlineActions}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void query.refetch();
              }}
            >
              Regenerar resumen
            </Button>
          </div>
        </div>
      )}
    </PanelState>
  );
}
