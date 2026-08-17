'use client';

/**
 * Panel en vivo del onsale.
 *
 * Se apoya en el contrato nuevo: un `availability` inicial para los totales, una
 * paginación de `seats` para saber el reparto por zona, y el SSE de deltas para
 * mantenerlo al día sin volver a pedir 45.000 filas cada tres segundos.
 *
 * El estado butaca→estado vive en un `ref`, no en `useState`: con 45.000 entradas
 * un `setState` por latido volvería a renderizar el árbol entero cada 3 s. Solo
 * los agregados (que son decenas de números) viajan por el estado de React.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyDelta,
  countOf,
  getAvailability,
  loadAllSeats,
  inventoryStreamUrl,
  occupancyPercent,
  soldCount,
  SEAT_STATUS_LABEL,
  CONSUMED_STATUSES,
  type AvailabilitySnapshot,
  type InventoryStreamMessage,
  type SeatStatus,
} from './inventory-api';
import { ApiErrorView, LoadingView } from './api-state';
import styles from './live-inventory.module.scss';

type ZoneTally = {
  section: string;
  total: number;
  available: number;
  held: number;
  sold: number;
};

type ConnectionState = 'connecting' | 'live' | 'retrying' | 'offline';

/** Ventana para el ritmo de venta. Más corta oscila demasiado; más larga no avisa a tiempo. */
const RATE_WINDOW_MS = 5 * 60 * 1000;

/** Por debajo de esto una zona se marca como casi agotada. */
const LOW_STOCK_RATIO = 0.1;

export function LiveInventoryPanel({
  token,
  eventId,
  eventTitle,
}: {
  token: string;
  eventId: string;
  eventTitle?: string;
}) {
  const [snapshot, setSnapshot] = useState<AvailabilitySnapshot | null>(null);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [zones, setZones] = useState<ZoneTally[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [seatProgress, setSeatProgress] = useState(0);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [salesPerMinute, setSalesPerMinute] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);

  /** butacaId → estado. Fuera de React por tamaño (hasta 45.000 entradas). */
  const statusByIdRef = useRef<Map<string, string>>(new Map());
  /** butacaId → zona, para recalcular el aforo por zona sin releer las páginas. */
  const zoneByIdRef = useRef<Map<string, string>>(new Map());
  const zoneTallyRef = useRef<Map<string, ZoneTally>>(new Map());
  /** Marcas de tiempo de las ventas recientes, para el ritmo. */
  const saleTimesRef = useRef<number[]>([]);
  /** Espejo de los totales: el handler del SSE los lee sin re-suscribirse. */
  const totalsRef = useRef<Record<string, number>>({});
  useEffect(() => {
    totalsRef.current = totals;
  }, [totals]);

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  /* Carga inicial: totales primero (rápido), detalle por zona después. */
  useEffect(() => {
    if (!token || !eventId) return;
    const controller = new AbortController();
    setError(null);
    setSeatProgress(0);

    getAvailability(token, eventId, { signal: controller.signal })
      .then((snap) => {
        if (controller.signal.aborted) return;
        setSnapshot(snap);
        setTotals(snap.totals ?? {});
        setLoadingSeats(true);

        // El detalle por zona solo existe en `seats`; `availability` agrupa por
        // oferta, que no siempre coincide con la zona del mapa.
        const statusById = new Map<string, string>();
        const zoneById = new Map<string, string>();
        const tally = new Map<string, ZoneTally>();

        return loadAllSeats(token, eventId, {
          signal: controller.signal,
          onPage: (items, loaded) => {
            for (const seat of items) {
              const zone = seat.section ?? 'Sin zona';
              statusById.set(seat.id, seat.status);
              zoneById.set(seat.id, zone);
              const row =
                tally.get(zone) ?? { section: zone, total: 0, available: 0, held: 0, sold: 0 };
              row.total++;
              if (seat.status === 'AVAILABLE') row.available++;
              else if (seat.status === 'HELD') row.held++;
              else if (CONSUMED_STATUSES.includes(seat.status as SeatStatus)) row.sold++;
              tally.set(zone, row);
            }
            setSeatProgress(loaded);
          },
        }).then(() => {
          if (controller.signal.aborted) return;
          statusByIdRef.current = statusById;
          zoneByIdRef.current = zoneById;
          zoneTallyRef.current = tally;
          setZones([...tally.values()].sort((a, b) => b.total - a.total));
          setLoadingSeats(false);
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err);
        setLoadingSeats(false);
      });

    return () => controller.abort();
  }, [token, eventId, reloadNonce]);

  /* SSE de deltas. La ruta es pública: EventSource no puede mandar cabeceras. */
  useEffect(() => {
    if (!eventId || !snapshot) return;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let attempt = 0;

    function connect() {
      if (closed) return;
      setConnection(attempt === 0 ? 'connecting' : 'retrying');
      source = new EventSource(inventoryStreamUrl(eventId));

      source.onopen = () => {
        attempt = 0;
        setConnection('live');
      };

      source.onmessage = (msg) => {
        let payload: InventoryStreamMessage;
        try {
          payload = JSON.parse(msg.data) as InventoryStreamMessage;
        } catch {
          return;
        }
        if (payload.type === 'heartbeat') {
          setLastEventAt(payload.at);
          return;
        }
        if (payload.type !== 'delta') return;
        setLastEventAt(payload.until);

        // `truncated` significa que el servidor cortó en 2000 cambios: el recuento
        // local ya no es fiable y hay que rehacerlo desde cero.
        if (payload.truncated) {
          reload();
          return;
        }

        const zoneById = zoneByIdRef.current;
        const tally = zoneTallyRef.current;
        const statusById = statusByIdRef.current;

        // El reparto por zona se ajusta con los mismos cambios, sin releer páginas.
        for (const change of payload.changes) {
          const zone = zoneById.get(change.id);
          if (!zone) continue;
          const row = tally.get(zone);
          if (!row) continue;
          const prev = statusById.get(change.id);
          if (prev === change.status) continue;
          if (prev === 'AVAILABLE') row.available--;
          else if (prev === 'HELD') row.held--;
          else if (prev && CONSUMED_STATUSES.includes(prev as SeatStatus)) row.sold--;
          if (change.status === 'AVAILABLE') row.available++;
          else if (change.status === 'HELD') row.held++;
          else if (CONSUMED_STATUSES.includes(change.status as SeatStatus)) row.sold++;
        }

        const result = applyDelta(totalsRef.current, statusById, payload.changes);
        totalsRef.current = result.totals;
        setTotals(result.totals);

        if (result.newlySold > 0) {
          const now = Date.now();
          for (let i = 0; i < result.newlySold; i++) saleTimesRef.current.push(now);
        }
        setZones([...tally.values()].sort((a, b) => b.total - a.total));
      };

      source.onerror = () => {
        source?.close();
        if (closed) return;
        attempt++;
        // Retroceso exponencial con techo: un onsale no debe martillear el API.
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
        setConnection(attempt > 5 ? 'offline' : 'retrying');
        retryTimer = setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      closed = true;
      source?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [eventId, snapshot, reload]);

  /* Ritmo de venta sobre una ventana móvil. */
  useEffect(() => {
    const timer = setInterval(() => {
      const cutoff = Date.now() - RATE_WINDOW_MS;
      saleTimesRef.current = saleTimesRef.current.filter((t) => t >= cutoff);
      const minutes = RATE_WINDOW_MS / 60000;
      setSalesPerMinute(Math.round((saleTimesRef.current.length / minutes) * 10) / 10);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const live: AvailabilitySnapshot | null = useMemo(
    () => (snapshot ? { ...snapshot, totals } : null),
    [snapshot, totals],
  );

  const available = countOf(live, 'AVAILABLE');
  const held = countOf(live, 'HELD');
  const sold = soldCount(live);
  const occupancy = occupancyPercent(live);

  /** Zonas casi agotadas: es la alerta que de verdad se acciona durante el onsale. */
  const alerts = useMemo(() => {
    const out: { zone: string; left: number; ratio: number; severity: 'out' | 'low' }[] = [];
    for (const z of zones) {
      if (!z.total) continue;
      const ratio = z.available / z.total;
      if (z.available === 0) out.push({ zone: z.section, left: 0, ratio, severity: 'out' });
      else if (ratio <= LOW_STOCK_RATIO)
        out.push({ zone: z.section, left: z.available, ratio, severity: 'low' });
    }
    return out.sort((a, b) => a.ratio - b.ratio);
  }, [zones]);

  /** Minutos hasta agotar al ritmo actual: la cifra que pide producción. */
  const minutesToSellOut =
    salesPerMinute > 0 && available > 0 ? Math.round(available / salesPerMinute) : null;

  if (error) {
    return <ApiErrorView error={error} context="leer el inventario del evento" onRetry={reload} />;
  }
  if (!live) return <LoadingView label="Leyendo inventario…" />;

  const connectionLabel: Record<ConnectionState, string> = {
    connecting: 'Conectando al stream…',
    live: 'En vivo',
    retrying: 'Reconectando…',
    offline: 'Sin stream — cifras congeladas',
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.statusBar}>
        {/* El estado no depende solo del color: lleva texto y un símbolo. */}
        <p className={styles.connection} data-state={connection} role="status" aria-live="polite">
          <span className={styles.dot} aria-hidden="true" />
          {connectionLabel[connection]}
          {lastEventAt && connection === 'live' && (
            <span className={styles.muted}>
              {' '}
              · último cambio {new Date(lastEventAt).toLocaleTimeString('es-MX')}
            </span>
          )}
        </p>
        <button type="button" className={styles.refreshBtn} onClick={reload}>
          Recalcular desde el servidor
        </button>
      </div>

      {connection === 'offline' && (
        <p className={styles.alertBanner} role="alert">
          Se perdió el stream de inventario. Las cifras de abajo son las últimas conocidas y no se
          están actualizando. Usa «Recalcular desde el servidor» para volver a leerlas.
        </p>
      )}

      <div className={styles.kpis}>
        <article className={styles.kpi}>
          <span>Disponibles</span>
          <strong>{available.toLocaleString('es-MX')}</strong>
          <small>de {live.totalTickets.toLocaleString('es-MX')} emitidos</small>
        </article>
        <article className={styles.kpi}>
          <span>Vendidos</span>
          <strong>{sold.toLocaleString('es-MX')}</strong>
          <small>{occupancy}% de ocupación</small>
        </article>
        <article className={styles.kpi}>
          <span>En hold</span>
          <strong>{held.toLocaleString('es-MX')}</strong>
          <small>{live.activeHolds.toLocaleString('es-MX')} holds activos</small>
        </article>
        <article className={styles.kpi}>
          <span>Ritmo</span>
          <strong>{salesPerMinute.toLocaleString('es-MX')}/min</strong>
          <small>
            {minutesToSellOut !== null
              ? `agotado en ~${minutesToSellOut} min a este ritmo`
              : 'ventana de 5 min'}
          </small>
        </article>
      </div>

      {alerts.length > 0 && (
        <section className={styles.alerts} aria-labelledby="onsale-alerts">
          <h3 id="onsale-alerts">Alertas de aforo</h3>
          <ul>
            {alerts.slice(0, 8).map((a) => (
              <li key={a.zone} data-severity={a.severity}>
                <span className={styles.alertTag}>{a.severity === 'out' ? 'AGOTADA' : 'BAJA'}</span>
                <strong>{a.zone}</strong>{' '}
                {a.severity === 'out'
                  ? '— sin butacas disponibles.'
                  : `— quedan ${a.left.toLocaleString('es-MX')} butacas (${Math.round(a.ratio * 100)}%).`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="onsale-zones">
        <h3 id="onsale-zones" className={styles.sectionTitle}>
          Aforo restante por zona
          {loadingSeats && (
            <span className={styles.muted}>
              {' '}
              · cargando detalle ({seatProgress.toLocaleString('es-MX')} butacas)
            </span>
          )}
        </h3>
        {zones.length === 0 && !loadingSeats ? (
          <p className={styles.muted}>
            El evento todavía no tiene inventario publicado, o ninguna butaca trae zona.
          </p>
        ) : (
          <table className={styles.table}>
            <caption className={styles.srOnly}>
              Butacas disponibles, en hold y vendidas por zona del recinto
            </caption>
            <thead>
              <tr>
                <th scope="col">Zona</th>
                <th scope="col">Disponibles</th>
                <th scope="col">Hold</th>
                <th scope="col">Vendidas</th>
                <th scope="col">Total</th>
                <th scope="col">Ocupación</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => {
                const pct = z.total ? Math.round((z.sold / z.total) * 100) : 0;
                return (
                  <tr key={z.section}>
                    <th scope="row">{z.section}</th>
                    <td>{z.available.toLocaleString('es-MX')}</td>
                    <td>{z.held.toLocaleString('es-MX')}</td>
                    <td>{z.sold.toLocaleString('es-MX')}</td>
                    <td>{z.total.toLocaleString('es-MX')}</td>
                    <td>
                      <span className={styles.meter}>
                        <span className={styles.meterFill} style={{ width: `${pct}%` }} />
                      </span>
                      <span className={styles.meterLabel}>{pct}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <details className={styles.breakdown}>
        <summary>Desglose completo por estado</summary>
        <ul>
          {Object.entries(totals)
            .filter(([, n]) => n > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([status, n]) => (
              <li key={status}>
                {SEAT_STATUS_LABEL[status] ?? status}: <strong>{n.toLocaleString('es-MX')}</strong>
              </li>
            ))}
        </ul>
        <p className={styles.muted}>
          Instantánea generada {new Date(live.generatedAt).toLocaleString('es-MX')}
          {eventTitle ? ` · ${eventTitle}` : ''}
        </p>
      </details>
    </div>
  );
}
