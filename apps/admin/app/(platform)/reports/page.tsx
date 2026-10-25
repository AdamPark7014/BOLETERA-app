'use client';

import { Suspense, useEffect, useState } from 'react';
import { ParameterCard, TicketButton, formatTicketAmount } from '@boletera/ui';
import { ApiError, adminApi, adminDownload } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { getEgressOverview, type EgressOverviewVenue } from '@/lib/platform-api';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param } from '../events/_ticket/controls';
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

function egressMeta(venue: EgressOverviewVenue): string {
  const clearance =
    venue.clearanceMinutes == null
      ? null
      : `${venue.clearanceMinutes.toLocaleString('es-MX', { maximumFractionDigits: 1 })} min`;
  return [
    `${formatCount(venue.sections)} secciones`,
    `${formatCount(venue.seatsWithPath)} con camino`,
    `${formatCount(venue.seatsWithoutPath)} sin camino`,
    clearance,
  ]
    .filter((part): part is string => part != null)
    .join(' · ');
}

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
  const canSales = session.role === 'PROMOTER' || session.role === 'ADMIN' || session.role === 'SUPER_ADMIN';

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
        salesMessage = 'El corte de venta lo devuelve el API a promotor y administrador.';
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
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return <ApiErrorView error={error} context="abrir reportes" onRetry={() => setNonce((current) => current + 1)} />;
  }
  if (loading || !token) return <p className={styles.quiet}>Cargando reportes.</p>;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Reportes</h1>
        <p className={styles.quiet}>Corte de venta de los últimos 30 días, y egress.</p>
      </header>
      <div className={styles.stack}>
        <Param name="Analítica">
          <ParameterCard
            name="Analítica"
            value="Encendida"
            effect="Lo fija el entorno. El API no la lee ni la escribe. Aquí se lee."
          />
        </Param>
      </div>
      <header className={styles.sectionHead}>
        <p className={styles.rowTitle}>Corte de venta</p>
        {salesNote ? <p className={styles.tertiary}>{salesNote}</p> : null}
      </header>
      {sales && sales.length === 0 ? <p className={styles.quiet}>Nada con ese criterio.</p> : null}
      {sales && sales.length > 0 ? (
        <div className={styles.rows}>
          <div className={styles.row}>
            <p className={styles.rowMeta}>Canal</p>
            <p className={styles.rowMeta}>Órdenes</p>
            <p className={styles.rowMeta}>Total</p>
          </div>
          {sales.map((row) => (
            <div key={row.channel} className={styles.row}>
              <p className={styles.rowTitle}>{channelLabel(row.channel)}</p>
              <p className={styles.figure}>{formatCount(row.orders)}</p>
              <p className={styles.figure}>{formatTicketAmount(row.total)}</p>
            </div>
          ))}
        </div>
      ) : null}
      {orgId ? (
        <TicketButton variant="secondary" disabled={exporting} onClick={() => void exportSales()}>
          Exportar ventas
        </TicketButton>
      ) : null}
      {exportError ? (
        <p className={styles.danger} role="alert">
          {exportError}
        </p>
      ) : null}
      <header className={styles.sectionHead}>
        <p className={styles.rowTitle}>Egress</p>
        {egressNote ? <p className={styles.tertiary}>{egressNote}</p> : null}
      </header>
      {venues && venues.length === 0 ? <p className={styles.quiet}>Nada con ese criterio.</p> : null}
      {venues && venues.length > 0 ? (
        <div className={styles.rows}>
          {venues.map((venue) => (
            <div key={venue.venueId} className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>{venue.venueName}</p>
                <p className={styles.rowMeta}>{egressMeta(venue)}</p>
              </div>
              <span />
              <p className={styles.figure}>{venue.statusReason}</p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
