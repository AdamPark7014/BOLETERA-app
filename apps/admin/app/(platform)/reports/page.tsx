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
import { adminApi, adminDownload, ApiError, getStoredToken } from '@/lib/api';
import { useToast } from '@/components/Toast/ToastProvider';
import platform from '../_styles/platform.module.scss';
import styles from '../orders/orders.module.scss';
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

type Period = 'DAILY' | 'WEEKLY' | 'MONTHLY';

const PERIOD_LABEL: Record<Period, string> = {
  DAILY: 'Hoy',
  WEEKLY: 'Últimos 7 días',
  MONTHLY: 'Últimos 30 días',
};

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
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Reportes</h1>
          <p>Ventas por canal, liquidación y cortes de taquilla</p>
        </div>
        {session.phase === 'ready' && (
          <button
            type="button"
            className={platform.primaryBtn}
            disabled={exporting}
            onClick={() => void exportSales(session.orgId)}
          >
            {exporting ? 'Preparando…' : 'Exportar ventas (CSV)'}
          </button>
        )}
      </header>

      <section className={platform.panel}>
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
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.channel}>
                      <th scope="row">{r.channel}</th>
                      <td className={styles.numeric}>{formatNumber(r._count)}</td>
                      <td className={styles.numeric}>{formatMoney(r._sum.totalAmount, 'MXN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </ResourceView>
      </section>

      <section className={platform.panel}>
        <div className={styles.toolbar}>
          <h2 style={{ margin: 0, flex: 1 }}>Liquidación</h2>
          <div className={styles.filters} role="group" aria-label="Periodo de la liquidación">
            {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={period === p}
                className={period === p ? styles.filterActive : styles.filter}
                onClick={() => setPeriod(p)}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
        </div>

        <ResourceView resource={settlement} context="la liquidación" loadingRows={3}>
          {(data) => <SettlementView data={data} period={period} />}
        </ResourceView>
      </section>

      <section className={platform.panel}>
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

      <div className={platform.cardGrid}>
        <article className={platform.statCard}>
          <span>Bruto esperado</span>
          <strong>{formatMoney(gross, currency)}</strong>
          <small>Suma de los totales de orden</small>
        </article>
        <article className={platform.statCard}>
          <span>Liquidado por pasarelas</span>
          <strong>{methods.length ? formatMoney(settled, currency) : 'Sin desglose'}</strong>
          <small>{mismatch ? 'No coincide con lo esperado' : 'Coincide con lo esperado'}</small>
        </article>
        <article className={platform.statCard}>
          <span>Comisión</span>
          <strong>{formatMoney(summary.commission, currency)}</strong>
        </article>
        <article className={platform.statCard}>
          <span>Neto al promotor</span>
          <strong>{formatMoney(summary.netRevenue, currency)}</strong>
        </article>
        <article className={platform.statCard}>
          <span>Órdenes</span>
          <strong>{formatNumber(summary.totalOrders)}</strong>
          <small>Ticket promedio {formatMoney(summary.avgOrderValue, currency)}</small>
        </article>
      </div>

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
  report?: { totalRevenue?: number; totalOrders?: number; currency?: string };
};

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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sessionId}>
                  <th scope="row">{r.terminalName || r.sessionId.slice(0, 8)}</th>
                  <td>{r.cashierId?.slice(0, 10) ?? '—'}</td>
                  <td>{formatDateTime(r.endedAt)}</td>
                  <td className={styles.numeric}>
                    {formatMoney(r.report?.totalRevenue, r.report?.currency ?? 'MXN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </ResourceView>
  );
}
