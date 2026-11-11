'use client';

/**
 * Bitácora de auditoría.
 *
 * Nota sobre el API: `GET /organization/:orgId/audit` solo acepta `limit`. No
 * hay filtros de servidor ni paginación expuesta, así que el filtrado es del
 * lado del cliente sobre la ventana traída.
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { Field, TicketButton } from '@boletera/ui';
import { hasCapability } from '@/lib/permissions';
import { getAuditLog } from '@/lib/platform-api';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Segment, SheetSelect } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { formatCount, formatWhen } from '../events/_ticket/read';
import { actionLabel, entityLabel } from './_lib/labels';
import own from './audit.module.scss';

type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  userId?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** Cuántas filas se traen por ventana. */
const PAGE_SIZES = ['80', '200', '500'] as const;
type PageSize = (typeof PAGE_SIZES)[number];

const LIMIT_OPTIONS = PAGE_SIZES.map((value) => ({ value, label: `Últimas ${value}` }));

/**
 * Acciones destacadas: las que se buscan cuando algo salió mal con el dinero o
 * con un acceso. Se listan explícitas para filtrarlas sin saber su nombre.
 */
const NOTABLE_ACTIONS: { value: string; label: string; severity: 'alert' | 'info' }[] = [
  { value: 'payment.settlement_mismatch', label: 'Descuadre de liquidación', severity: 'alert' },
  { value: 'payment.late_settlement', label: 'Liquidación tardía', severity: 'alert' },
  { value: 'order.settlement_failed', label: 'Liquidación fallida', severity: 'alert' },
  { value: 'order.insufficient_inventory', label: 'Inventario insuficiente', severity: 'alert' },
  { value: 'order.comp_issued', label: 'Cortesía emitida', severity: 'info' },
  { value: 'access.qr.reissued_by_staff', label: 'QR reemitido en puerta', severity: 'info' },
];

const NOTABLE_BY_VALUE = new Map(NOTABLE_ACTIONS.map((item) => [item.value, item]));

type QuickRange = 'all' | 'today' | '7d' | '30d';

const QUICK_RANGES: { value: QuickRange; label: string }[] = [
  { value: 'all', label: 'Todo' },
  { value: 'today', label: 'Hoy' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
];

const ALL_ACTIONS = '__todas__';

function startOfQuickRange(range: QuickRange): Date | null {
  const now = new Date();
  switch (range) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case '7d':
      return new Date(now.getTime() - 7 * 86_400_000);
    case '30d':
      return new Date(now.getTime() - 30 * 86_400_000);
    default:
      return null;
  }
}

/** El API no une con `User`: el correo solo aparece si la acción lo guardó. */
function actorOf(row: AuditRow): string {
  const meta = row.metadata ?? {};
  const email =
    typeof meta.actorEmail === 'string'
      ? meta.actorEmail
      : typeof meta.email === 'string'
        ? meta.email
        : null;
  if (email) return email;
  if (row.userId) return row.userId;
  return 'Sistema';
}

function labelOf(action: string): string {
  return NOTABLE_BY_VALUE.get(action)?.label ?? actionLabel(action);
}

export default function AuditPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <AuditoriaBody />
      </AdminFrame>
    </Suspense>
  );
}

function AuditoriaBody() {
  const session = useSession();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [limit, setLimit] = useState<PageSize>('80');
  const [nonce, setNonce] = useState(0);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [quick, setQuick] = useState<QuickRange>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const token = session.token;
  const orgId = session.status === 'ready' ? session.orgId : null;
  const canSee = hasCapability(session.role, 'audit.view');

  useEffect(() => {
    if (!token || !orgId || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    getAuditLog(token, orgId, Number(limit))
      .then((payload) => {
        if (alive) setRows(Array.isArray(payload) ? payload : []);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setRows([]);
        setError(cause);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, orgId, canSee, session.status, limit, nonce]);

  const actionOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.action, (counts.get(row.action) ?? 0) + 1);
    const notable = NOTABLE_ACTIONS.map((item) => ({
      value: item.value,
      label: `${item.label} · ${formatCount(counts.get(item.value) ?? 0)}`,
    }));
    const others = [...counts.keys()]
      .filter((value) => !NOTABLE_BY_VALUE.has(value))
      .sort()
      .map((value) => ({
        value,
        label: `${actionLabel(value)} · ${formatCount(counts.get(value) ?? 0)}`,
      }));
    return [{ value: ALL_ACTIONS, label: 'Todas las acciones' }, ...notable, ...others];
  }, [rows]);

  const filtered = useMemo(() => {
    const quickStart = startOfQuickRange(quick);
    const fromDate = from ? new Date(`${from}T00:00:00`) : quickStart;
    // El día "hasta" se incluye entero.
    const toDate = to ? new Date(`${to}T23:59:59.999`) : null;
    const needle = actor.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (action && row.action !== action) return false;
        const when = new Date(row.createdAt);
        if (fromDate && when < fromDate) return false;
        if (toDate && when > toDate) return false;
        if (needle) {
          const haystack = `${actorOf(row)} ${row.userId ?? ''}`.toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [rows, actor, action, quick, from, to]);

  const alerts = useMemo(
    () => filtered.filter((row) => NOTABLE_BY_VALUE.get(row.action)?.severity === 'alert').length,
    [filtered]
  );
  const distinctActions = useMemo(() => new Set(rows.map((row) => row.action)).size, [rows]);
  const anyFilter = Boolean(actor || action || from || to || quick !== 'all');

  function clearFilters() {
    setActor('');
    setAction('');
    setQuick('all');
    setFrom('');
    setTo('');
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Auditoría</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir la auditoría"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (!token || (loading && rows.length === 0))
    return <p className={styles.quiet}>Cargando auditoría.</p>;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Auditoría</h1>
        <p className={styles.quiet}>
          Acciones críticas de la organización. Los filtros se aplican sobre las filas traídas.
        </p>
      </header>

      <div className={own.counts}>
        <div className={own.count}>
          <p className={styles.rowMeta}>Eventos traídos</p>
          <p className={own.figure}>{formatCount(rows.length)}</p>
        </div>
        <div className={own.count}>
          <p className={styles.rowMeta}>Coinciden</p>
          <p className={own.figure}>{formatCount(filtered.length)}</p>
        </div>
        <div className={own.count}>
          <p className={styles.rowMeta}>Requieren revisión</p>
          <p className={own.figure}>{formatCount(alerts)}</p>
        </div>
        <div className={own.count}>
          <p className={styles.rowMeta}>Acciones distintas</p>
          <p className={own.figure}>{formatCount(distinctActions)}</p>
        </div>
      </div>

      {alerts > 0 ? (
        <div className={own.alert}>
          <p className={styles.danger} role="alert">
            {formatCount(alerts)} {alerts === 1 ? 'evento' : 'eventos'} de pago o inventario por
            revisar: descuadres, liquidaciones fallidas o inventario insuficiente.
          </p>
        </div>
      ) : null}

      <div className={own.filters}>
        <div className={own.line}>
          <div className={own.grow}>
            <Field
              label="Actor"
              kind="search"
              placeholder="Correo o ID de usuario"
              value={actor}
              onChange={(event) => setActor(event.target.value)}
            />
          </div>
          <div className={own.grow}>
            <p className={own.label}>Acción</p>
            <SheetSelect
              label="Acción"
              value={action || ALL_ACTIONS}
              placeholder="Todas las acciones"
              options={actionOptions}
              onChange={(next) => setAction(next === ALL_ACTIONS ? '' : next)}
            />
          </div>
        </div>
        <div className={own.line}>
          <div className={own.fixed}>
            <p className={own.label}>Rango</p>
            <div className={own.seg}>
              <Segment
                label="Rango"
                value={quick}
                options={QUICK_RANGES}
                onChange={(next) => {
                  setQuick(next);
                  setFrom('');
                  setTo('');
                }}
              />
            </div>
          </div>
          <div className={own.date}>
            <Field
              label="Desde"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => {
                setFrom(event.target.value);
                setQuick('all');
              }}
            />
          </div>
          <div className={own.date}>
            <Field
              label="Hasta"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => {
                setTo(event.target.value);
                setQuick('all');
              }}
            />
          </div>
          <div className={own.fixed}>
            <p className={own.label}>Filas a traer</p>
            <div className={own.seg}>
              <Segment
                label="Filas a traer"
                value={limit}
                options={LIMIT_OPTIONS}
                onChange={setLimit}
              />
            </div>
          </div>
        </div>
        <div className={own.line}>
          <p className={styles.tertiary}>
            {loading
              ? 'Actualizando.'
              : `${formatCount(filtered.length)} de ${formatCount(rows.length)} eventos traídos.`}
          </p>
          {anyFilter ? (
            <TicketButton variant="ghost" onClick={clearFilters}>
              Limpiar filtros
            </TicketButton>
          ) : null}
          <TicketButton
            variant="secondary"
            disabled={loading}
            onClick={() => setNonce((current) => current + 1)}
          >
            Actualizar
          </TicketButton>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className={styles.quiet}>
          {rows.length === 0
            ? 'No hay eventos de auditoría para esta organización.'
            : 'Ningún evento coincide. Amplía el rango, trae más filas o quita un filtro.'}
        </p>
      ) : (
        <div className={styles.rows}>
          {filtered.map((row) => (
            <div key={row.id} className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>{labelOf(row.action)}</p>
                <p className={styles.rowMeta}>
                  {actorOf(row)} · <span className={own.code}>{row.action}</span>
                </p>
              </div>
              <p className={styles.rowMeta}>
                {entityLabel(row.entityType)}
                {row.entityId ? (
                  <span className={own.code}> {row.entityId.slice(0, 12)}</span>
                ) : null}
              </p>
              <p className={own.when}>{formatWhen(row.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
