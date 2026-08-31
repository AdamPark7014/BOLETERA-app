'use client';

/**
 * Reportes de dinero.
 *
 * El contraste importante de esta pantalla: `summary.grossRevenue` se calcula
 * sumando `Order.totalAmount` (lo que se esperaba cobrar) mientras que
 * `paymentMethods[].amount` sale de `Payment.amount` (lo que la pasarela
 * liquidó de verdad). Antes se pintaban como si fueran la misma cifra. Ahora se
 * comparan y, si no cuadran, se dice — que es justo el caso que el backend
 * registra como `payment.settlement_mismatch`.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
} from '@boletera/ui';
import { adminApi, adminDownload, ApiError, getStoredToken } from '@/lib/api';
import { useToast } from '@/components/Toast/ToastProvider';
import platform from '../_styles/platform.module.scss';
import styles from '../orders/orders.module.scss';
import reportStyles from './reports.module.scss';
import { EmptyBlock, Notice, ResourceView } from '../orders/_ui/States';
import { useAdminSession, useResource } from '../orders/_ui/useResource';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyDelta,
  formatNumber,
  isSettlementMismatch,
  toNumber,
} from '../orders/_ui/format';
import { channelLabel } from '../orders/_lib/format';

type Period = 'DAILY' | 'WEEKLY' | 'MONTHLY';

const PERIOD_LABEL: Record<Period, string> = {
  DAILY: 'Hoy',
  WEEKLY: 'Últimos 7 días',
  MONTHLY: 'Últimos 30 días',
};

const PERIOD_OPTIONS = (Object.keys(PERIOD_LABEL) as Period[]).map((value) => ({
  value,
  label: PERIOD_LABEL[value],
}));

/** Campos reales de `GET /reports/settlement/:organizationId/:period`. */
type Settlement = {
  organizationId: string;
  period: string;
  dateRange?: { gte: string; lt: string };
  summary?: {
    grossRevenue?: number;
    commission?: number;
    netRevenue?: number;
    totalOrders?: number;
    avgOrderValue?: number;
    currency?: string;
  };
  paymentMethods?: Record<string, { count: number; amount: number }>;
  generatedAt?: string;
};

type SalesRow = { channel: string; _sum: { totalAmount: string | null }; _count: number };

export default function ReportsPage() {
  const [period, setPeriod] = useState<Period>('WEEKLY');
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  // La organización sale de la sesión, no del cuerpo del reporte: el export
  // necesita el id aunque la liquidación venga vacía.
  const session = useAdminSession();

  const sales = useResource<SalesRow[]>(
    useCallback(
      ({ token, signal }) => adminApi<SalesRow[]>('/admin/reports/sales', token, { signal }),
      [],
    ),
    { requiresOrg: false },
  );

  const settlement = useResource<Settlement>(
    useCallback(
      ({ token, orgId, signal }) =>
        adminApi<Settlement>(`/reports/settlement/${orgId}/${period}`, token, { signal }),
      [period],
    ),
    { deps: [period] },
  );

  /**
   * Descarga autenticada: el `fetch` suelto anterior escribía el CSV aunque la
   * respuesta fuera un 403 en JSON, produciendo un archivo con el error dentro.
   */
  async function exportSales(orgId: string) {
    const token = getStoredToken();
    if (!token) return;
    setExporting(true);
    try {
      await adminDownload(
        `/reports/export/sales/${orgId}`,
        token,
        `ventas-${new Date().toISOString().slice(0, 10)}.csv`,
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.userMessage : 'No se pudo exportar el CSV');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={reportStyles.page}>
      <PageHeader
        eyebrow="Finanzas"
        title="Reportes"
        description="Ventas por canal, liquidación y cortes de taquilla"
        actions={
          session.phase === 'ready' ? (
            <Button
              type="button"
              loading={exporting}
              loadingLabel="Preparando…"
              onClick={() => void exportSales(session.orgId)}
            >
              Exportar ventas (CSV)
            </Button>
          ) : undefined
        }
      />

      <section className={reportStyles.panel}>
        <h2>Ventas por canal</h2>
        <p className={styles.scopeNote}>
          Ventana por omisión del API: <strong>últimos 30 días</strong>. Importes sobre el total
          esperado de cada orden.
        </p>
        <ResourceView resource={sales} context="las ventas por canal" loadingRows={3}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyBlock
                title="Sin ventas en la ventana consultada"
                hint="No hubo órdenes en los últimos 30 días para esta organización."
              />
            ) : (
              <table className={platform.table}>
                <caption className={styles.srOnly}>Ventas agrupadas por canal</caption>
                <thead>
                  <tr>
                    <th scope="col">Canal</th>
                    <th scope="col" className={styles.numeric}>
                      Órdenes
                    </th>
                    <th scope="col" className={styles.numeric}>
                      Total esperado
                    </th>
                    <th scope="col" className={styles.numeric}>
                      Participación
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows]
                    .sort(
                      (a, b) =>
                        Number(b._sum.totalAmount ?? 0) - Number(a._sum.totalAmount ?? 0),
                    )
                    .map((r) => {
                      const total = rows.reduce(
                        (sum, row) => sum + Number(row._sum.totalAmount ?? 0),
                        0,
                      );
                      const amount = Number(r._sum.totalAmount ?? 0);
                      const share = total > 0 ? (amount / total) * 100 : 0;
                      return (
                        <tr key={r.channel}>
                          <th scope="row">{channelLabel(r.channel)}</th>
                          <td className={styles.numeric}>{formatNumber(r._count)}</td>
                          <td className={styles.numeric}>
                            {formatMoney(r._sum.totalAmount, 'MXN')}
                          </td>
                          <td className={styles.numeric}>{share.toFixed(1)} %</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )
          }
        </ResourceView>
      </section>

      <section className={reportStyles.panel}>
        <div className={reportStyles.panelHead}>
          <h2>Liquidación</h2>
          <SegmentedControl
            label="Periodo"
            size="sm"
            options={PERIOD_OPTIONS}
            value={period}
            onValueChange={(value) => setPeriod(value as Period)}
          />
        </div>

        <ResourceView resource={settlement} context="la liquidación" loadingRows={3}>
          {(data) => <SettlementView data={data} period={period} />}
        </ResourceView>
      </section>

      <section className={reportStyles.panel}>
        <h2>Cortes de taquilla (Z)</h2>
        <ZReportsBlock />
      </section>
    </div>
  );
}

function SettlementView({ data, period }: { data: Settlement; period: Period }) {
  const summary = data.summary ?? {};
  const currency = (summary.currency || 'MXN').toUpperCase();
  const methods = useMemo(() => Object.entries(data.paymentMethods ?? {}), [data.paymentMethods]);

  const gross = toNumber(summary.grossRevenue);
  /** Suma de lo que las pasarelas reportan como liquidado. */
  const settled = methods.reduce((s, [, v]) => s + toNumber(v.amount), 0);
  const mismatch = methods.length > 0 && isSettlementMismatch(gross, settled);

  const hasData = (summary.totalOrders ?? 0) > 0 || gross > 0 || methods.length > 0;

  if (!hasData) {
    return (
      <EmptyBlock
        title={`Sin movimientos en el periodo (${PERIOD_LABEL[period].toLowerCase()})`}
        hint={
          data.dateRange
            ? `Ventana consultada: ${formatDate(data.dateRange.gte)} – ${formatDate(data.dateRange.lt)}.`
            : 'No hubo órdenes completadas en la ventana solicitada.'
        }
      />
    );
  }

  return (
    <>
      <p className={styles.scopeNote}>
        Periodo{' '}
        <strong>
          {data.dateRange
            ? `${formatDate(data.dateRange.gte)} – ${formatDate(data.dateRange.lt)}`
            : PERIOD_LABEL[period]}
        </strong>
        {data.generatedAt && <> · generado {formatDateTime(data.generatedAt)}</>}.
      </p>

      {mismatch && (
        <Notice tone="warn" title="Lo esperado y lo liquidado no cuadran en este periodo">
          <p>
            Las órdenes suman {formatMoney(gross, currency)} y las pasarelas reportan{' '}
            {formatMoney(settled, currency)} (
            {formatMoneyDelta(settled - gross, currency)}). Concilia antes de generar el payout: la
            diferencia suele venir de órdenes con <code>payment.settlement_mismatch</code> o de
            reembolsos sin cerrar.
          </p>
        </Notice>
      )}

      <Section columns={4} gap="md" className={reportStyles.kpiStrip}>
        <KpiCard
          label="Bruto esperado"
          value={formatMoney(gross, currency)}
          hint="Suma de totales de orden"
          tone="accent"
        />
        <KpiCard
          label="Liquidado"
          value={methods.length ? formatMoney(settled, currency) : 'Sin desglose'}
          tone={mismatch ? 'warning' : 'success'}
          hint={mismatch ? 'No coincide con lo esperado' : 'Coincide con lo esperado'}
        />
        <KpiCard label="Comisión" value={formatMoney(summary.commission, currency)} />
        <KpiCard
          label="Neto al promotor"
          value={formatMoney(summary.netRevenue, currency)}
          tone="success"
          hint={`${formatNumber(summary.totalOrders ?? 0)} órdenes · ticket ${formatMoney(summary.avgOrderValue, currency)}`}
        />
      </Section>

      {methods.length > 0 && (
        <table className={platform.table} style={{ marginTop: '1rem' }}>
          <caption className={styles.srOnly}>Importes liquidados por pasarela</caption>
          <thead>
            <tr>
              <th scope="col">Pasarela</th>
              <th scope="col" className={styles.numeric}>
                Transacciones
              </th>
              <th scope="col" className={styles.numeric}>
                Liquidado
              </th>
            </tr>
          </thead>
          <tbody>
            {methods.map(([gw, v]) => (
              <tr key={gw}>
                <th scope="row">{gw}</th>
                <td className={styles.numeric}>{formatNumber(v.count)}</td>
                <td className={styles.numeric}>{formatMoney(v.amount, currency)}</td>
              </tr>
            ))}
            <tr className={styles.breakdownTotal}>
              <th scope="row">Total liquidado</th>
              <td className={styles.numeric}>
                {formatNumber(methods.reduce((s, [, v]) => s + v.count, 0))}
              </td>
              <td className={styles.numeric}>{formatMoney(settled, currency)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </>
  );
}

type ZReport = {
  sessionId: string;
  terminalName?: string;
  cashierId: string;
  endedAt?: string;
  report?: {
    totalRevenue?: number;
    totalOrders?: number;
    totalTransactions?: number;
    currency?: string;
    variance?: number;
    dropsTotal?: number;
    expectedCash?: number;
    closingCashCounted?: number;
    cashSales?: number;
    cardSales?: number;
  };
};

function zReportCsv(rows: ZReport[]) {
  const header = [
    'sessionId',
    'terminal',
    'cashierId',
    'endedAt',
    'totalRevenue',
    'cashSales',
    'cardSales',
    'dropsTotal',
    'expectedCash',
    'counted',
    'variance',
  ];
  const lines = rows.map((r) => {
    const rep = r.report ?? {};
    return [
      r.sessionId,
      r.terminalName ?? '',
      r.cashierId ?? '',
      r.endedAt ?? '',
      rep.totalRevenue ?? '',
      rep.cashSales ?? '',
      rep.cardSales ?? '',
      rep.dropsTotal ?? '',
      rep.expectedCash ?? '',
      rep.closingCashCounted ?? '',
      rep.variance ?? '',
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(',');
  });
  return [header.join(','), ...lines].join('\n');
}

function downloadZCsv(rows: ZReport[]) {
  const blob = new Blob([zReportCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cortes-caja-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function ZReportsBlock() {
  const resource = useResource<ZReport[]>(
    useCallback(
      ({ token, orgId, signal }) =>
        adminApi<ZReport[]>(
          `/taquilla/z-reports?organizationId=${encodeURIComponent(orgId)}`,
          token,
          { signal },
        ),
      [],
    ),
  );

  return (
    <ResourceView resource={resource} context="los cortes de taquilla" loadingRows={2}>
      {(rows) =>
        rows.length === 0 ? (
          <EmptyBlock
            title="Sin cortes archivados"
            hint="Aparecerán aquí cuando una terminal de taquilla cierre su turno."
          />
        ) : (
          <>
            <div className={reportStyles.toolbar}>
              <Button type="button" variant="secondary" size="sm" onClick={() => downloadZCsv(rows)}>
                Exportar CSV
              </Button>
            </div>
            <table className={platform.table}>
              <caption className={styles.srOnly}>Cortes de caja archivados por terminal</caption>
              <thead>
                <tr>
                  <th scope="col">Terminal</th>
                  <th scope="col">Cajero</th>
                  <th scope="col">Cierre</th>
                  <th scope="col" className={styles.numeric}>
                    Total
                  </th>
                  <th scope="col" className={styles.numeric}>
                    Retiros
                  </th>
                  <th scope="col" className={styles.numeric}>
                    Esperado
                  </th>
                  <th scope="col" className={styles.numeric}>
                    Contado
                  </th>
                  <th scope="col" className={styles.numeric}>
                    Diferencia
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const currency = r.report?.currency ?? 'MXN';
                  const variance = r.report?.variance;
                  return (
                    <tr key={r.sessionId}>
                      <th scope="row">{r.terminalName || r.sessionId.slice(0, 8)}</th>
                      <td>{r.cashierId?.slice(0, 10) ?? '—'}</td>
                      <td>{formatDateTime(r.endedAt)}</td>
                      <td className={styles.numeric}>
                        {formatMoney(r.report?.totalRevenue, currency)}
                      </td>
                      <td className={styles.numeric}>
                        {formatMoney(r.report?.dropsTotal ?? 0, currency)}
                      </td>
                      <td className={styles.numeric}>
                        {formatMoney(r.report?.expectedCash, currency)}
                      </td>
                      <td className={styles.numeric}>
                        {formatMoney(r.report?.closingCashCounted, currency)}
                      </td>
                      <td className={styles.numeric}>
                        {variance === undefined || variance === null
                          ? '—'
                          : formatMoneyDelta(variance, currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )
      }
    </ResourceView>
  );
}
