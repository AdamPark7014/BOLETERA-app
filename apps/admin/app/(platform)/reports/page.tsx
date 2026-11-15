'use client';

import { NoAccess } from '@/app/(platform)/events/_ticket/NoAccess';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { TicketButton, formatTicketAmount } from '@boletera/ui';
import { ApiError, adminApi, adminDownload } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { getEgressOverview, type EgressOverviewVenue } from '@/lib/platform-api';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import styles from '../events/_ticket/frame.module.scss';
import { channelLabel } from '../events/_ticket/holds';
import { asRecord, formatCount, readNumber, readString } from '../events/_ticket/read';

type SalesRow = {
  channel: string;
  orders: number;
  total: number;
};

function countOf(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const row = asRecord(value);
  return readNumber(row._all) ?? 0;
}

function readSales(payload: unknown): SalesRow[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((item) => {
    const row = asRecord(item);
    const sum = asRecord(row._sum);
    const total = readNumber(sum.totalAmount);
    const channel = readString(row.channel) ?? '—';
    if (total == null) return [];
    return [{ channel, orders: countOf(row._count), total }];
  });
}

const EGRESS_CHIP: Record<string, string> = {
  ok: styles.chipOk,
  warn: styles.chipWarn,
  critical: styles.chipDanger,
  'no-network': styles.chip,
  empty: styles.chip,
};

function failMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.userMessage;
  return 'No se guardó. Revisa la conexión.';
}

export default function ReportsPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <ReportesBody />
      </AdminFrame>
    </Suspense>
  );
}

function ReportesBody() {
  const session = useSession();
  const [sales, setSales] = useState<SalesRow[] | null>(null);
  const [salesNote, setSalesNote] = useState<string | null>(null);
  const [venues, setVenues] = useState<EgressOverviewVenue[] | null>(null);
  const [egressNote, setEgressNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const orgId = session.status === 'ready' ? session.orgId : null;
  const canSee = hasCapability(session.role, 'reports.view');
  const canSales =
    session.role === 'PROMOTER' || session.role === 'ADMIN' || session.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!token || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    const bearer = token;
    let alive = true;
    setError(null);
    async function load() {
      let salesRows: SalesRow[] | null = null;
      let salesMessage: string | null = null;
      if (canSales) {
        try {
          salesRows = readSales(await adminApi<unknown>('/admin/reports/sales', bearer));
        } catch (cause) {
          salesMessage = failMessage(cause);
        }
      } else {
        salesMessage = 'El corte de venta lo ven promotores y administradores.';
      }
      let egressRows: EgressOverviewVenue[] | null = null;
      let egressMessage: string | null = null;
      try {
        egressRows = (await getEgressOverview(bearer)).venues;
      } catch (cause) {
        egressMessage = failMessage(cause);
      }
      if (!alive) return;
      if (salesMessage && egressMessage && canSales) {
        throw new Error(salesMessage);
      }
      setSales(salesRows);
      setSalesNote(salesMessage);
      setVenues(egressRows);
      setEgressNote(egressMessage);
    }
    void load()
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, canSee, canSales, session.status, nonce]);

  async function exportSales() {
    if (!token || !orgId || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      await adminDownload(`/reports/export/sales/${orgId}`, token, 'ventas.csv');
    } catch (cause) {
      setExportError(failMessage(cause));
    } finally {
      setExporting(false);
    }
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Reportes</h1>
          <NoAccess />
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir reportes"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (loading || !token) {
    return (
      <div className={styles.stack} aria-busy="true" aria-label="Cargando reportes">
        <div className={styles.skeleton} style={{ height: 48, maxWidth: 320 }} />
        <div className={styles.skeleton} style={{ height: 120 }} />
        <div className={styles.skeleton} style={{ height: 320 }} />
      </div>
    );
  }

  const rows = [...(sales ?? [])].sort((a, b) => b.total - a.total);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const orders = rows.reduce((sum, row) => sum + row.orders, 0);
  const top = rows[0];

  return (
    <section className={styles.page}>
      <header className={styles.pageHead}>
        <div className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Reportes</h1>
          <p className={styles.quiet}>
            Corte de venta de los últimos 30 días y salida de público por recinto.
          </p>
        </div>
        {orgId && canSales ? (
          <TicketButton disabled={exporting} onClick={() => void exportSales()}>
            {exporting ? 'Preparando archivo' : 'Exportar ventas (CSV)'}
          </TicketButton>
        ) : null}
      </header>
      {exportError ? (
        <p className={styles.danger} role="alert">
          {exportError}
        </p>
      ) : null}

      {sales ? (
        <div className={styles.kpis}>
          <div className={styles.kpi}>
            <p className={styles.kpiLabel}>Venta de 30 días</p>
            <p className={styles.kpiValue}>{formatTicketAmount(total)}</p>
            <p className={styles.kpiNote}>órdenes cobradas, todos los canales</p>
          </div>
          <div className={styles.kpi}>
            <p className={styles.kpiLabel}>Órdenes</p>
            <p className={styles.kpiValue}>{formatCount(orders)}</p>
            <p className={styles.kpiNote}>
              {orders > 0 ? `${formatTicketAmount(total / orders)} en promedio` : 'sin órdenes'}
            </p>
          </div>
          <div className={styles.kpi}>
            <p className={styles.kpiLabel}>Canal principal</p>
            <p className={styles.kpiValue}>{top ? channelLabel(top.channel) : '—'}</p>
            <p className={styles.kpiNote}>
              {top && total > 0
                ? `${Math.round((top.total / total) * 100)}% de la venta`
                : 'sin ventas todavía'}
            </p>
          </div>
        </div>
      ) : null}

      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Corte de venta por canal</h2>
          {salesNote ? <p className={styles.tertiary}>{salesNote}</p> : null}
        </div>
        {sales && rows.length === 0 ? (
          <p className={styles.quiet}>No hubo órdenes cobradas en los últimos 30 días.</p>
        ) : null}
        {rows.length > 0 ? (
          <div className={styles.tableWrap} style={{ border: 0, background: 'transparent' }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Canal</th>
                  <th scope="col">Participación</th>
                  <th scope="col" className={styles.num}>
                    Órdenes
                  </th>
                  <th scope="col" className={styles.num}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const share = total > 0 ? (row.total / total) * 100 : 0;
                  return (
                    <tr key={row.channel}>
                      <td>
                        <strong>{channelLabel(row.channel)}</strong>
                      </td>
                      <td style={{ minWidth: 160 }}>
                        <div className={styles.shareCell}>
                          <div className={styles.bar} style={{ flex: 1, height: 6 }}>
                            <div
                              className={styles.barFill}
                              style={{ width: `${Math.max(share, 1)}%` }}
                            />
                          </div>
                          <span className={styles.shareNum}>{share.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className={styles.num}>{formatCount(row.orders)}</td>
                      <td className={styles.num}>
                        <strong>{formatTicketAmount(row.total)}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Salida de público por recinto</h2>
          <Link href="/reports/egress" className={styles.panelLink}>
            Ver detalle
          </Link>
        </div>
        {egressNote ? <p className={styles.tertiary}>{egressNote}</p> : null}
        {venues && venues.length === 0 ? (
          <p className={styles.quiet}>Ningún recinto tiene plano con rutas de salida todavía.</p>
        ) : null}
        {venues && venues.length > 0 ? (
          <div className={styles.tableWrap} style={{ border: 0, background: 'transparent' }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Recinto</th>
                  <th scope="col" className={styles.num}>
                    Secciones
                  </th>
                  <th scope="col" className={styles.num}>
                    Butacas con ruta
                  </th>
                  <th scope="col" className={styles.num}>
                    Desalojo
                  </th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {venues.map((venue) => (
                  <tr key={venue.venueId}>
                    <td>
                      <strong>{venue.venueName}</strong>
                    </td>
                    <td className={styles.num}>{formatCount(venue.sections)}</td>
                    <td className={styles.num}>
                      {formatCount(venue.seatsWithPath)}
                      {venue.seatsWithoutPath > 0 ? (
                        <span className={styles.rowMeta}>
                          {' '}
                          · {formatCount(venue.seatsWithoutPath)} sin ruta
                        </span>
                      ) : null}
                    </td>
                    <td className={styles.num}>
                      {venue.clearanceMinutes == null
                        ? '—'
                        : `${venue.clearanceMinutes.toLocaleString('es-MX', { maximumFractionDigits: 1 })} min`}
                    </td>
                    <td>
                      <span className={EGRESS_CHIP[venue.status] ?? styles.chip}>
                        {venue.statusReason}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
