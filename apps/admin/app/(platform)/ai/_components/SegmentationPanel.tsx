'use client';

import type { AiSegmentationResponse } from '@boletera/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import styles from '../../events/_ticket/frame.module.scss';
import { formatCount, formatGeneratedAt, formatMxn, formatRatio } from '../_lib/format';
import { confidenceLabel, segmentLabel, sufficiencyLabel } from '../_lib/labels';
import { PanelEmpty, PanelState } from './PanelState';

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
      isEmpty={(value) => value.segments.length === 0 && value.customers.length === 0}
      emptyTitle="Sin segmentación de clientes"
      emptyDescription="RFM y abandono aparecen cuando hay historial de compras suficiente. Con muestra insuficiente el motor lo declara; no se fabrican segmentos."
    >
      {(data) => {
        const topCustomers = [...data.customers]
          .sort((a, b) => b.monetaryMxn - a.monetaryMxn)
          .slice(0, 12);
        return (
          <div className={styles.stack}>
            <p className={styles.tertiary}>
              {sufficiencyLabel(data.sufficiency)} · {formatCount(data.sampleSize)} clientes en
              muestra · {formatGeneratedAt(data.generatedAt)}
            </p>
            {data.segments.length > 0 ? (
              <ul className={styles.rows}>
                {data.segments.map((row) => (
                  <li key={row.segment} className={styles.row}>
                    <div className={styles.rowMain}>
                      <p className={styles.rowTitle}>{segmentLabel(row.segment)}</p>
                      <p className={styles.rowMeta}>
                        {formatRatio(row.percentOfTotal / 100)} del total · promedio{' '}
                        {formatMxn(row.averageMonetaryMxn)}
                      </p>
                    </div>
                    <span />
                    <p className={styles.figure}>{formatCount(row.count)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <PanelEmpty
                title="Sin conteos por segmento"
                description="El motor respondió pero no hay distribución agregada."
              />
            )}
            {topCustomers.length > 0 ? (
              <>
                <p className={styles.rowTitle}>Clientes destacados</p>
                <ul className={styles.rows}>
                  {topCustomers.map((customer) => (
                    <li key={customer.userId} className={styles.row}>
                      <div className={styles.rowMain}>
                        <p className={styles.rowTitle}>{customer.email || customer.userId}</p>
                        <p className={styles.rowMeta}>
                          {segmentLabel(customer.segment)} · R {formatCount(customer.recencyDays)} d
                          · F {formatCount(customer.frequency)} ·{' '}
                          {customer.churnProbability === null
                            ? 'abandono sin dato'
                            : `abandono ${formatRatio(customer.churnProbability)} (${confidenceLabel(customer.churnConfidence)})`}
                        </p>
                      </div>
                      <span />
                      <p className={styles.figure}>{formatMxn(customer.monetaryMxn)}</p>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <PanelEmpty
                title="Sin filas de cliente"
                description="Hay resumen de segmentos pero el motor no devolvió clientes individuales en este lote."
              />
            )}
            <p className={styles.tertiary}>
              {data.method.name}: {data.method.rationale}
            </p>
          </div>
        );
      }}
    </PanelState>
  );
}
