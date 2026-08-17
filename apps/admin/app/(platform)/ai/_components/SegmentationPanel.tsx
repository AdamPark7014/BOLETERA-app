'use client';

import type { AiSegmentationResponse } from '@boletera/shared';
import { Badge, DonutChart } from '@boletera/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { formatCount, formatGeneratedAt, formatMxn, formatRatio } from '../_lib/format';
import type { AiCustomerSegment } from '@boletera/shared';
import {
  confidenceLabel,
  confidenceTone,
  segmentLabel,
  sufficiencyLabel,
  sufficiencyTone,
} from '../_lib/labels';
import styles from '../ai.module.scss';
import { PanelEmpty, PanelState } from './PanelState';

const SEGMENT_COLORS = {
  champion: '#059669',
  loyal: '#0d9488',
  promising: '#2563eb',
  at_risk: '#d97706',
  hibernating: '#71717a',
  new: '#7c3aed',
  insufficient_history: '#a1a1aa',
} as const satisfies Record<AiCustomerSegment, string>;

export function SegmentationPanel({
  query,
}: {
  query: UseQueryResult<AiSegmentationResponse, Error>;
}) {
  return (
    <PanelState
      data={query.data}
      isPending={query.isPending}
      error={query.error}
      onRetry={() => {
        void query.refetch();
      }}
      isEmpty={(value) =>
        value.segments.length === 0 && value.customers.length === 0
      }
      emptyTitle="Sin segmentación de clientes"
      emptyDescription="RFM y churn aparecen cuando hay historial de compras suficiente. Con muestra insuficiente el motor lo declara; no se fabrican segmentos."
      emptyHints={['GET /ai/segmentation/customers', 'Segmentos RFM + churn']}
    >
      {(data) => {
        const donutSlices = data.segments
          .filter((row) => row.count > 0)
          .map((row) => ({
            id: row.segment,
            label: segmentLabel(row.segment),
            value: row.count,
            color: SEGMENT_COLORS[row.segment],
          }));

        const topCustomers = [...data.customers]
          .sort((a, b) => b.monetaryMxn - a.monetaryMxn)
          .slice(0, 12);

        return (
          <div className={styles.stackTight}>
            <div className={styles.metaRow}>
              <Badge tone={sufficiencyTone(data.sufficiency)} variant="outline">
                {sufficiencyLabel(data.sufficiency)}
              </Badge>
              <Badge tone="neutral" variant="outline">
                {formatCount(data.sampleSize)} clientes en muestra
              </Badge>
              <span className={styles.muted}>
                {formatGeneratedAt(data.generatedAt)}
              </span>
            </div>

            {donutSlices.length > 0 ? (
              <DonutChart
                label="Distribución por segmento"
                slices={donutSlices}
                formatValue={(value) => formatCount(value)}
              />
            ) : (
              <PanelEmpty
                title="Sin conteos por segmento"
                description="El motor respondió pero no hay distribución agregada para graficar."
              />
            )}

            {data.segments.length > 0 ? (
              <ul className={styles.segmentSummary}>
                {data.segments.map((row) => (
                  <li key={row.segment}>
                    <div>
                      <strong>{segmentLabel(row.segment)}</strong>
                      <span className={styles.muted}>
                        {formatRatio(row.percentOfTotal / 100)} del total
                      </span>
                    </div>
                    <div className={styles.comparableStats}>
                      <span>{formatCount(row.count)}</span>
                      <span>{formatMxn(row.averageMonetaryMxn)} avg</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {topCustomers.length > 0 ? (
              <div className={styles.comparables}>
                <h3 className={styles.blockTitle}>Clientes destacados</h3>
                <ul className={styles.customerList}>
                  {topCustomers.map((customer) => (
                    <li key={customer.userId}>
                      <div>
                        <strong>{customer.email || customer.userId}</strong>
                        <span className={styles.muted}>
                          {segmentLabel(customer.segment)} · R{' '}
                          {formatCount(customer.recencyDays)}d · F{' '}
                          {formatCount(customer.frequency)}
                        </span>
                      </div>
                      <div className={styles.customerStats}>
                        <span>{formatMxn(customer.monetaryMxn)}</span>
                        {customer.churnProbability === null ? (
                          <Badge tone="neutral" variant="outline">
                            Churn n/d
                          </Badge>
                        ) : (
                          <Badge
                            tone={confidenceTone(customer.churnConfidence)}
                            variant="outline"
                          >
                            Churn {formatRatio(customer.churnProbability)} (
                            {confidenceLabel(customer.churnConfidence)})
                          </Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <PanelEmpty
                title="Sin filas de cliente"
                description="Hay resumen de segmentos pero el motor no devolvió clientes individuales en este lote."
              />
            )}

            <p className={styles.methodNote}>
              {data.method.name}: {data.method.rationale}
            </p>
          </div>
        );
      }}
    </PanelState>
  );
}
