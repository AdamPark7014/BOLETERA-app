'use client';

/**
 * Panel en vivo del onsale.
 *
 * Dos fuentes, deliberadamente separadas:
 *
 *  · **Agregados de negocio** (`/reports/dashboard/realtime/:orgId`). Su SSE
 *    exige JWT y `EventSource` no puede mandar cabeceras
 *    (`ExtractJwt.fromAuthHeaderAsBearerToken()` es el único extractor), así que
 *    ese stream devuelve 401 desde el navegador. Se consulta por sondeo
 *    autenticado y se dice en pantalla cada cuánto se refresca — antes se abría
 *    el `EventSource` y se caía en silencio a un sondeo que el usuario creía
 *    "en vivo".
 *
 *  · **Inventario** (`/inventory/:eventId/availability` + `/stream`). Estas sí
 *    son públicas, así que el SSE de deltas funciona y es la señal realmente
 *    en vivo: de ahí salen el ritmo y el aforo restante por zona.
 *
 * `availability` ya no trae `tickets[]`: son conteos agregados
 * (`totals`, `byOffer`, `activeHolds`, `totalTickets`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KpiCard, Section } from '@boletera/ui';
import { getEventHub, getRealtimeDashboard, type RealtimeDashboard } from '@/lib/platform-api';
import {
  LoadingBlock,
  Notice,
  ResourceView,
} from '@/app/(platform)/orders/_ui/States';
import { useAdminSession, useResource } from '@/app/(platform)/orders/_ui/useResource';
import {
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
} from '@/app/(platform)/orders/_ui/format';
import platform from '../app/(platform)/_styles/platform.module.scss';
import styles from '../app/(platform)/orders/orders.module.scss';

const DASHBOARD_POLL_MS = 15_000;
/** El snapshot se cachea 5 s en el API; no tiene sentido pedirlo más seguido. */
const AVAILABILITY_MIN_REFETCH_MS = 5_000;
/** Ventana para calcular el ritmo de venta. */
const RATE_WINDOW_MS = 5 * 60_000;

const API_BASE = () => process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';

type TicketChange = { id: string; seatId: string | null; offerId: string; status: string };

type StreamPayload =
  | { type: 'delta'; eventId: string; since: string; until: string; truncated: boolean; changes: TicketChange[] }
  | { type: 'heartbeat'; eventId: string; at: string };

type Availability = {
  eventId: string;
  generatedAt: string;
  since: string;
  totalTickets: number;
  totals: Record<string, number>;
  byOffer: { offerId: string; total: number; counts: Record<string, number> }[];
  activeHolds: number;
};

type OfferMeta = { id: string; name: string; zone: string };

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: 'Disponibles',
  HELD: 'Apartados',
  SOLD: 'Vendidos',
  RESERVED: 'Reservados',
  USED: 'Usados',
  CANCELLED: 'Cancelados',
  REFUNDED: 'Reembolsados',
  BLOCKED: 'Bloqueados',
};

const SOLD_STATES = new Set(['SOLD', 'USED', 'TRANSFERRED']);

function available(counts: Record<string, number>): number {
  return counts.AVAILABLE ?? 0;
}

function soldOf(counts: Record<string, number>): number {
  return Object.entries(counts).reduce((s, [k, v]) => (SOLD_STATES.has(k) ? s + v : s), 0);
}

export function RealtimeDashboardPanel({ eventId }: { eventId?: string }) {
  return (
    <div>
      <OrgMetrics eventId={eventId} />
      {eventId ? (
        <LiveInventory eventId={eventId} />
      ) : (
        <p className={styles.scopeNote}>
          Elige un evento para ver el aforo restante por zona y el ritmo de venta en vivo.
        </p>
      )}
    </div>
  );
}

/** Agregados de negocio: sondeo autenticado, con la frescura declarada. */
function OrgMetrics({ eventId }: { eventId?: string }) {
  const [tick, setTick] = useState(0);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), DASHBOARD_POLL_MS);
    return () => clearInterval(id);
  }, []);

  const resource = useResource<RealtimeDashboard>(
    useCallback(
      async ({ token, orgId }) => {
        const data = await getRealtimeDashboard(token, orgId, eventId);
        setFetchedAt(new Date());
        return data;
      },
      [eventId],
    ),
    { deps: [eventId, tick] },
  );

  return (
    <ResourceView resource={resource} context="las métricas del panel" loadingRows={2}>
      {(data) => (
        <>
          <Section columns={4} gap="md" aria-label="Agregados de negocio">
            <KpiCard
              label="Hoy"
              value={formatMoney(data.metrics.todayRevenue, 'MXN')}
              hint={`${formatNumber(data.metrics.todayOrders)} órdenes`}
              tone="accent"
            />
            <KpiCard
              label="Semana"
              value={formatMoney(data.metrics.weekRevenue, 'MXN')}
              hint={`${formatNumber(data.metrics.weekOrders)} órdenes`}
              tone="neutral"
            />
            <KpiCard
              label="Ticket promedio"
              value={formatMoney(data.metrics.avgOrderValue, 'MXN')}
              tone="neutral"
            />
            <KpiCard
              label="Ocupación"
              value={formatPercent(data.metrics.occupancy, 0)}
              hint={`${formatNumber(data.metrics.soldTickets)} de ${formatNumber(data.metrics.totalTickets)} boletos`}
              tone="info"
            />
          </Section>

          <p className={styles.scopeNote}>
            Agregados de negocio actualizados cada {DASHBOARD_POLL_MS / 1000} s
            {fetchedAt && <> · último dato {formatRelative(fetchedAt)}</>}. Importes en pesos
            mexicanos.
          </p>

          {data.channels.length > 0 && (
            <table className={platform.table} style={{ marginBottom: '1rem' }}>
              <caption className={styles.srOnly}>Ventas por canal en los últimos 7 días</caption>
              <thead>
                <tr>
                  <th scope="col">Canal (7 días)</th>
                  <th scope="col" className={styles.numeric}>
                    Órdenes
                  </th>
                  <th scope="col" className={styles.numeric}>
                    Ingresos
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.channels.map((c) => (
                  <tr key={c.channel}>
                    <th scope="row">{c.channel}</th>
                    <td className={styles.numeric}>{formatNumber(c.orders)}</td>
                    <td className={styles.numeric}>{formatMoney(c.revenue, 'MXN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </ResourceView>
  );
}

/** Inventario en vivo: snapshot agregado + SSE de deltas. */
function LiveInventory({ eventId }: { eventId: string }) {
  const session = useAdminSession();
  const [snapshot, setSnapshot] = useState<Availability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [offers, setOffers] = useState<Record<string, OfferMeta>>({});
  /** Marcas de tiempo de boletos que pasaron a vendido, para el ritmo. */
  const salesLog = useRef<number[]>([]);
  const [rate, setRate] = useState(0);
  const lastFetch = useRef(0);

  const load = useCallback(async () => {
    const now = Date.now();
    if (now - lastFetch.current < AVAILABILITY_MIN_REFETCH_MS) return;
    lastFetch.current = now;
    try {
      const res = await fetch(`${API_BASE()}/inventory/${encodeURIComponent(eventId)}/availability`);
      if (!res.ok) throw new Error(String(res.status));
      setSnapshot((await res.json()) as Availability);
      setError(null);
    } catch {
      setError('No se pudo leer la disponibilidad del evento.');
    }
  }, [eventId]);

  // Snapshot inicial + red de seguridad si el SSE no levanta.
  useEffect(() => {
    void load();
    const id = setInterval(() => {
      lastFetch.current = 0;
      void load();
    }, 20_000);
    return () => clearInterval(id);
  }, [load]);

  // Nombres de zona: `byOffer` solo trae ids y "offer 3f2a…" no le dice nada a nadie.
  useEffect(() => {
    if (session.phase !== 'ready') return;
    let cancelled = false;
    getEventHub(session.token, eventId)
      .then((hub) => {
        if (cancelled) return;
        const map: Record<string, OfferMeta> = {};
        for (const o of hub.event.offers ?? []) map[o.id] = { id: o.id, name: o.name, zone: o.zone };
        setOffers(map);
      })
      .catch(() => {
        /* Sin permiso sobre el evento: se muestran los ids y ya. */
      });
    return () => {
      cancelled = true;
    };
  }, [session, eventId]);

  // SSE de deltas: esta ruta sí es pública, así que es la señal en vivo real.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource(`${API_BASE()}/inventory/${encodeURIComponent(eventId)}/stream`);
    es.onopen = () => setConnected(true);
    es.onmessage = (ev) => {
      let payload: StreamPayload;
      try {
        payload = JSON.parse(ev.data) as StreamPayload;
      } catch {
        return;
      }
      setConnected(true);
      if (payload.type !== 'delta') return;
      if (payload.truncated) setTruncated(true);
      const sold = payload.changes.filter((c) => SOLD_STATES.has(c.status)).length;
      if (sold > 0) {
        const now = Date.now();
        for (let i = 0; i < sold; i += 1) salesLog.current.push(now);
      }
      // Los deltas dicen *qué* cambió, no los totales; se repide el agregado
      // (cacheado 5 s en el API) para no llevar una cuenta paralela que derive.
      void load();
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [eventId, load]);

  // Ritmo: boletos vendidos por minuto en los últimos 5 minutos observados.
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - RATE_WINDOW_MS;
      salesLog.current = salesLog.current.filter((t) => t >= cutoff);
      setRate(salesLog.current.length / (RATE_WINDOW_MS / 60_000));
    }, 5_000);
    return () => clearInterval(id);
  }, []);

  const zones = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.byOffer
      .map((o) => {
        const meta = offers[o.offerId];
        const avail = available(o.counts);
        const sold = soldOf(o.counts);
        return {
          key: o.offerId,
          label: meta ? `${meta.zone} · ${meta.name}` : `Oferta ${o.offerId.slice(0, 8)}`,
          total: o.total,
          available: avail,
          held: o.counts.HELD ?? 0,
          sold,
          percentSold: o.total > 0 ? (sold / o.total) * 100 : 0,
        };
      })
      .sort((a, b) => a.available - b.available);
  }, [snapshot, offers]);

  const alerts = useMemo(() => {
    const out: { tone: 'warn' | 'danger' | 'info'; title: string; body: string }[] = [];
    if (!snapshot) return out;
    const soldOut = zones.filter((z) => z.available === 0 && z.total > 0);
    const almost = zones.filter((z) => z.available > 0 && z.total > 0 && z.available / z.total <= 0.1);
    if (soldOut.length) {
      out.push({
        tone: 'danger',
        title: `${soldOut.length} zona(s) agotadas`,
        body: `${soldOut.map((z) => z.label).join(', ')}. Considera abrir liberaciones o mover aforo antes de que suba el rebote de carritos.`,
      });
    }
    if (almost.length) {
      out.push({
        tone: 'warn',
        title: `${almost.length} zona(s) por agotarse`,
        body: `${almost.map((z) => `${z.label} (${formatNumber(z.available)} restantes)`).join(', ')}. Avisa a taquilla antes de vender de más por otro canal.`,
      });
    }
    const totalAvailable = available(snapshot.totals);
    if (snapshot.activeHolds > totalAvailable && totalAvailable >= 0) {
      out.push({
        tone: 'warn',
        title: 'Más apartados activos que boletos disponibles',
        body: `${formatNumber(snapshot.activeHolds)} apartados contra ${formatNumber(totalAvailable)} disponibles: si todos confirman, habrá carritos que fallen al pagar.`,
      });
    }
    if (truncated) {
      out.push({
        tone: 'info',
        title: 'El flujo en vivo venía truncado',
        body: 'Hubo más cambios de los que cabían en un lote. Los totales se repidieron completos, pero el ritmo mostrado se queda corto.',
      });
    }
    return out;
  }, [snapshot, zones, truncated]);

  if (!snapshot && !error) return <LoadingBlock rows={3} label="Cargando inventario en vivo…" />;

  if (error && !snapshot) {
    return (
      <Notice tone="danger" title="Sin datos de inventario">
        <p>{error} Revisa que el evento siga publicado y vuelve a intentar.</p>
      </Notice>
    );
  }

  const snap = snapshot!;
  const totalAvailable = available(snap.totals);
  const totalSold = soldOf(snap.totals);

  return (
    <>
      {alerts.map((a) => (
        <Notice key={a.title} tone={a.tone} title={a.title}>
          <p>{a.body}</p>
        </Notice>
      ))}

      <Section columns={4} gap="md" aria-label="Inventario en vivo">
        <KpiCard
          label="Aforo restante"
          value={formatNumber(totalAvailable)}
          hint={`de ${formatNumber(snap.totalTickets)} boletos`}
          tone="accent"
        />
        <KpiCard
          label="Vendidos"
          value={formatNumber(totalSold)}
          hint={`${formatPercent(snap.totalTickets ? (totalSold / snap.totalTickets) * 100 : 0, 1)} del aforo`}
          tone="success"
        />
        <KpiCard
          label="Apartados activos"
          value={formatNumber(snap.activeHolds)}
          hint="Carritos con butacas retenidas"
          tone={snap.activeHolds > totalAvailable && totalAvailable >= 0 ? 'warning' : 'info'}
        />
        <KpiCard
          label="Ritmo"
          value={`${rate.toFixed(1)}`}
          unit="/min"
          tone={connected ? 'accent' : 'neutral'}
          hint={
            connected
              ? 'Medido sobre los últimos 5 min de flujo en vivo'
              : 'Sin flujo en vivo: el ritmo no se está midiendo'
          }
        />
      </Section>

      <p className={styles.scopeNote}>
        {connected ? (
          <>Inventario <strong>en vivo</strong> (deltas por SSE)</>
        ) : (
          <>
            Inventario <strong>sin conexión en vivo</strong> — actualizando cada 20 s
          </>
        )}
        {' · '}
        instantánea de {formatRelative(snap.generatedAt)}.
      </p>

      <Section title="Aforo restante por zona">
        {zones.length === 0 ? (
          <p className={styles.subtle}>Este evento no tiene ofertas con inventario asignado.</p>
        ) : (
          <table className={platform.table}>
            <caption className={styles.srOnly}>
              Disponibilidad por zona, ordenada de menor a mayor aforo restante
            </caption>
            <thead>
              <tr>
                <th scope="col">Zona / oferta</th>
                <th scope="col" className={styles.numeric}>
                  Restantes
                </th>
                <th scope="col" className={styles.numeric}>
                  Apartados
                </th>
                <th scope="col" className={styles.numeric}>
                  Vendidos
                </th>
                <th scope="col" className={styles.numeric}>
                  Aforo
                </th>
                <th scope="col">Avance</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.key} className={z.available === 0 ? styles.rowAlert : undefined}>
                  <th scope="row">{z.label}</th>
                  <td className={styles.numeric}>{formatNumber(z.available)}</td>
                  <td className={styles.numeric}>{formatNumber(z.held)}</td>
                  <td className={styles.numeric}>{formatNumber(z.sold)}</td>
                  <td className={styles.numeric}>{formatNumber(z.total)}</td>
                  <td>
                    {/* Porcentaje en texto: la barra sola no es accesible. */}
                    {z.available === 0 ? 'Agotada' : formatPercent(z.percentSold, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <details style={{ marginTop: '1rem' }}>
          <summary className={styles.subtle}>Desglose por estado de boleto</summary>
          <table className={styles.ticketTable} style={{ marginTop: '0.5rem' }}>
            <tbody>
              {Object.entries(snap.totals)
                .filter(([, v]) => v > 0)
                .map(([status, count]) => (
                  <tr key={status}>
                    <th scope="row">{STATUS_LABEL[status] ?? status}</th>
                    <td>{formatNumber(count)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      </Section>
    </>
  );
}

/** Se conserva el export por omisión además del nombrado (ambos se usan). */
export default RealtimeDashboardPanel;
