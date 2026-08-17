'use client';

/**
 * Bitácora de auditoría.
 *
 * La pantalla anterior pedía 80 filas y las pintaba tal cual: sin filtros, sin
 * actor y comiéndose el error con `.catch(() => setRows([]))`, así que "no hay
 * eventos" y "no tienes permiso" se veían exactamente igual.
 *
 * Nota sobre el API: `GET /organization/:orgId/audit` solo acepta `limit`. No
 * hay filtros de servidor ni paginación expuesta, así que el filtrado es del
 * lado del cliente sobre la ventana traída. Está bien para operar el día a día;
 * para forensics de verdad hace falta filtrar en el servidor (ver ENTREGA).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, getStoredToken } from '@/lib/api';
import { getAuditLog } from '@/lib/platform-api';
import { useSession } from '@/components/Session/SessionProvider';
import platform from '../_styles/platform.module.scss';
import styles from './audit.module.scss';

type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  userId?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** Cuántas filas se traen por ventana. El API tope real es su propio `take`. */
const PAGE_SIZES = [80, 200, 500];

/**
 * Acciones destacadas. Las seis primeras son las que el API empezó a auditar
 * hace poco y son justo las que se buscan cuando algo salió mal con el dinero o
 * con un acceso; se listan explícitas para poder filtrarlas sin saber su nombre
 * exacto de memoria.
 */
const NOTABLE_ACTIONS: { value: string; label: string; severity: 'alert' | 'info' }[] = [
  { value: 'payment.settlement_mismatch', label: 'Descuadre de liquidación', severity: 'alert' },
  { value: 'payment.late_settlement', label: 'Liquidación tardía', severity: 'alert' },
  { value: 'order.settlement_failed', label: 'Liquidación fallida', severity: 'alert' },
  { value: 'order.insufficient_inventory', label: 'Inventario insuficiente', severity: 'alert' },
  { value: 'order.comp_issued', label: 'Cortesía emitida', severity: 'info' },
  { value: 'access.qr.reissued_by_staff', label: 'QR reemitido en puerta', severity: 'info' },
];

const NOTABLE_BY_VALUE = new Map(NOTABLE_ACTIONS.map((a) => [a.value, a]));

/** Rangos rápidos; el rango a medida siempre está disponible debajo. */
type QuickRange = 'all' | 'today' | '7d' | '30d';

const QUICK_RANGES: { value: QuickRange; label: string }[] = [
  { value: 'all', label: 'Todo' },
  { value: 'today', label: 'Hoy' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
];

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
function actorOf(row: AuditRow): { label: string; hint: string } {
  const meta = row.metadata ?? {};
  const email =
    typeof meta.actorEmail === 'string'
      ? meta.actorEmail
      : typeof meta.email === 'string'
        ? meta.email
        : null;
  if (email) return { label: email, hint: row.userId ?? '' };
  if (row.userId) return { label: row.userId, hint: 'Solo ID: el API no devuelve el correo' };
  return { label: 'Sistema', hint: 'Acción sin usuario (proceso automático o webhook)' };
}

export default function AuditPage() {
  const { organizationId } = useSession();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZES[0]);

  // Filtros
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [quick, setQuick] = useState<QuickRange>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    const token = getStoredToken();
    if (!token || !organizationId) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await getAuditLog(token, organizationId, limit));
    } catch (err) {
      // Un 401 ya lo reintentó `adminApi` tras reautenticar; si llega aquí es otra cosa.
      setError(err instanceof ApiError ? err.userMessage : 'No se pudo cargar la bitácora.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Acciones presentes en los datos + las destacadas, para el desplegable. */
  const actionOptions = useMemo(() => {
    const present = new Set(rows.map((r) => r.action));
    NOTABLE_ACTIONS.forEach((a) => present.add(a.value));
    return [...present].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const quickStart = startOfQuickRange(quick);
    const fromDate = from ? new Date(`${from}T00:00:00`) : quickStart;
    // El día "hasta" se incluye entero: quien escribe 16/08 espera ver el 16.
    const toDate = to ? new Date(`${to}T23:59:59.999`) : null;
    const needle = actor.trim().toLowerCase();

    return rows.filter((r) => {
      if (action && r.action !== action) return false;
      const when = new Date(r.createdAt);
      if (fromDate && when < fromDate) return false;
      if (toDate && when > toDate) return false;
      if (needle) {
        const { label } = actorOf(r);
        const haystack = `${label} ${r.userId ?? ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, actor, action, quick, from, to]);

  const alerts = useMemo(
    () => filtered.filter((r) => NOTABLE_BY_VALUE.get(r.action)?.severity === 'alert').length,
    [filtered],
  );

  const anyFilter = Boolean(actor || action || from || to || quick !== 'all');

  function clearFilters() {
    setActor('');
    setAction('');
    setQuick('all');
    setFrom('');
    setTo('');
  }

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Auditoría</h1>
          <p>Traza inmutable de acciones críticas — compliance y forensics</p>
        </div>
        <button
          type="button"
          className={platform.ghostBtn}
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </header>

      {/* Los descuadres y las liquidaciones fallidas no deberían aparecer nunca:
          si están, es lo primero que hay que mirar al abrir esta pantalla. */}
      {alerts > 0 && (
        <p className={styles.alertBar} role="status">
          <strong>{alerts}</strong> {alerts === 1 ? 'evento' : 'eventos'} de pago o inventario que
          requieren revisión en el rango seleccionado.
        </p>
      )}

      <section className={platform.panel} aria-labelledby="audit-filters">
        <h2 id="audit-filters" className={platform.panelTitle}>
          Filtros
        </h2>

        <div className={styles.filters}>
          <div className={styles.field}>
            <label htmlFor="audit-actor">Actor (correo o ID de usuario)</label>
            <input
              id="audit-actor"
              type="search"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder="ana@promotora.mx o cme3…"
              autoComplete="off"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="audit-action">Acción</label>
            <select
              id="audit-action"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              <option value="">Todas las acciones</option>
              <optgroup label="Requieren atención">
                {NOTABLE_ACTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Todas las registradas">
                {actionOptions
                  .filter((a) => !NOTABLE_BY_VALUE.has(a))
                  .map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
              </optgroup>
            </select>
          </div>

          <div className={styles.field}>
            <label htmlFor="audit-from">Desde</label>
            <input
              id="audit-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => {
                setFrom(e.target.value);
                setQuick('all');
              }}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="audit-to">Hasta</label>
            <input
              id="audit-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setTo(e.target.value);
                setQuick('all');
              }}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="audit-limit">Filas a traer</label>
            <select
              id="audit-limit"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  Últimas {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className={styles.quickRow}>
          <legend className={styles.quickLegend}>Rango rápido</legend>
          {QUICK_RANGES.map((r) => (
            <label
              key={r.value}
              className={`${styles.chip} ${quick === r.value ? styles.chipOn : ''}`}
            >
              <input
                type="radio"
                name="audit-range"
                value={r.value}
                checked={quick === r.value}
                onChange={() => {
                  setQuick(r.value);
                  setFrom('');
                  setTo('');
                }}
              />
              {r.label}
            </label>
          ))}
          {anyFilter && (
            <button type="button" className={styles.clearBtn} onClick={clearFilters}>
              Limpiar filtros
            </button>
          )}
        </fieldset>

        <p className={styles.resultCount} role="status">
          {loading
            ? 'Cargando eventos…'
            : `${filtered.length} de ${rows.length} eventos traídos${
                anyFilter ? ' coinciden con los filtros' : ''
              }.`}
        </p>
      </section>

      <section className={platform.panel}>
        {error ? (
          <div className={styles.errorBox} role="alert">
            <p>{error}</p>
            <button type="button" className={platform.ghostBtn} onClick={() => void load()}>
              Reintentar
            </button>
          </div>
        ) : (
          <>
            <table className={platform.table}>
              <caption className={styles.caption}>
                Eventos de auditoría de la organización, del más reciente al más antiguo.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Acción</th>
                  <th scope="col">Entidad</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const who = actorOf(r);
                  const notable = NOTABLE_BY_VALUE.get(r.action);
                  return (
                    <tr key={r.id}>
                      <td className={styles.when}>
                        {new Date(r.createdAt).toLocaleString('es-MX')}
                      </td>
                      <td>
                        <span className={styles.actor}>{who.label}</span>
                        {who.hint && <span className={styles.actorHint}>{who.hint}</span>}
                      </td>
                      <td>
                        {/* El estado no va solo por color: lleva su propia etiqueta. */}
                        {notable ? (
                          <span
                            className={
                              notable.severity === 'alert' ? styles.tagAlert : styles.tagInfo
                            }
                          >
                            {notable.label}
                          </span>
                        ) : (
                          <span className={styles.actionRaw}>{r.action}</span>
                        )}
                        <span className={styles.actionCode}>{r.action}</span>
                      </td>
                      <td>
                        <span className={styles.entity}>{r.entityType}</span>
                        {r.entityId && (
                          <code className={styles.entityId} title={r.entityId}>
                            {r.entityId.slice(0, 12)}…
                          </code>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {!loading && filtered.length === 0 && (
              <p className={styles.empty}>
                {rows.length === 0
                  ? 'Sin eventos registrados para esta organización.'
                  : 'Ningún evento de los traídos coincide con los filtros. Prueba a ampliar el rango o a traer más filas.'}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
