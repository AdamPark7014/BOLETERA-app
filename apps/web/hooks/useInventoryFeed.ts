'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ticketStatusToSeatStatus, type SeatStatus } from '@/components/seatmap/types';

/**
 * Alimentación de disponibilidad para el visor de butacas.
 *
 * Contrato del API (agosto 2026):
 *   GET  /inventory/:id/availability → SOLO agregados (ya no trae `tickets[]`)
 *   GET  /inventory/:id/seats        → detalle paginado por keyset sobre `id`
 *   SSE  /inventory/:id/stream       → deltas idempotentes + heartbeats
 *
 * Orden de arranque, y el porqué:
 *   1. `availability` primero: da contadores y aforo al instante, antes de
 *      tener una sola butaca pintada.
 *   2. El SSE se abre ANTES de paginar. Es lo que cierra de verdad el hueco
 *      entre snapshot y deltas: cualquier cambio que ocurra mientras se
 *      descargan las 23 páginas llega por el stream, y como los deltas ganan
 *      siempre sobre las páginas (ver `deltaSeenRef`), una página vieja no
 *      puede pisar un estado más nuevo.
 *   3. Paginación completa, cediendo el hilo entre páginas para que la pantalla
 *      siga respondiendo: el usuario puede interactuar con lo ya cargado.
 *   4. Poll de respaldo cada 12 s contra `availability` — NUNCA contra `seats`:
 *      45.000 filas cada 12 s por visor multiplicado por 30.000 concurrentes
 *      es exactamente lo que el contrato nuevo vino a evitar.
 */

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

/** Máximo que acepta el endpoint. 45.000 butacas ≈ 23 páginas. */
const SEAT_PAGE_LIMIT = 2000;
const POLL_MS = 12_000;
/**
 * Si el SSE lleva más de esto sin dar señales, el detalle por butaca ya no es
 * fiable. El servidor manda heartbeat cada 25 s, así que 45 s deja casi el
 * doble de margen: no salta por un tick perdido, pero sí por una conexión
 * muerta (típico al volver de segundo plano en móvil).
 */
const STALE_STREAM_MS = 45_000;
/** Suelo entre resincronizaciones completas: evita tormentas de páginas. */
const RESYNC_COOLDOWN_MS = 60_000;
/** Los repintados se agrupan: un delta por butaca no puede ser un render. */
const BUMP_THROTTLE_MS = 200;

export type InventoryAggregates = {
  eventId: string;
  generatedAt: string;
  since: string;
  totalTickets: number;
  totals: Record<string, number>;
  byOffer: Array<{ offerId: string; total: number; counts: Record<string, number> }>;
  activeHolds: number;
};

export type InventoryFeed = {
  /**
   * Estado por butaca. Es un ref mutable a propósito: recrear un objeto de
   * 45.000 claves en cada delta genera basura suficiente para provocar pausas
   * de GC visibles en gama media. Quien pinta lee de aquí y se entera de que
   * hay cambios por `version`.
   */
  statusRef: React.MutableRefObject<Map<string, SeatStatus>>;
  /** Sube (como mucho cada 200 ms) cuando `statusRef` cambió. */
  version: number;
  aggregates: InventoryAggregates | null;
  /** Boletos de detalle ya recibidos (para la barra de progreso). */
  loadedTickets: number;
  /** Sigue paginando `/seats`. */
  loadingDetail: boolean;
  /** El SSE está conectado. */
  live: boolean;
  error: string | null;
  /** Fuerza snapshot + repaginado completo (p. ej. tras un 409). */
  resync: () => void;
};

export function useInventoryFeed(eventId: string): InventoryFeed {
  const statusRef = useRef<Map<string, SeatStatus>>(new Map());
  /** Butacas cuyo estado llegó por SSE: las páginas no pueden pisarlas. */
  const deltaSeenRef = useRef<Set<string>>(new Set());

  const [version, setVersion] = useState(0);
  const [aggregates, setAggregates] = useState<InventoryAggregates | null>(null);
  const [loadedTickets, setLoadedTickets] = useState(0);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resyncNonce, setResyncNonce] = useState(0);

  const lastResyncRef = useRef(0);
  const bumpTimerRef = useRef<number | null>(null);
  const bumpPendingRef = useRef(false);

  /** Agrupa repintados: una ráfaga de deltas no puede ser una ráfaga de renders. */
  const scheduleBump = useCallback(() => {
    if (bumpTimerRef.current != null) {
      bumpPendingRef.current = true;
      return;
    }
    setVersion((v) => v + 1);
    bumpTimerRef.current = window.setTimeout(() => {
      bumpTimerRef.current = null;
      if (bumpPendingRef.current) {
        bumpPendingRef.current = false;
        setVersion((v) => v + 1);
      }
    }, BUMP_THROTTLE_MS);
  }, []);

  const resync = useCallback(() => {
    const now = Date.now();
    if (now - lastResyncRef.current < RESYNC_COOLDOWN_MS) return;
    lastResyncRef.current = now;
    setResyncNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();
    let cancelled = false;
    let es: EventSource | null = null;
    let pollTimer: number | null = null;
    let lastStreamAt = Date.now();

    async function loadAggregates(): Promise<InventoryAggregates | null> {
      const res = await fetch(`${API}/inventory/${eventId}/availability`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`availability ${res.status}`);
      const data = (await res.json()) as InventoryAggregates;
      if (!cancelled) {
        setAggregates(data);
        setError(null);
      }
      return data;
    }

    async function loadSeatPages() {
      let cursor: string | null = null;
      let loaded = 0;
      setLoadingDetail(true);
      do {
        const url =
          `${API}/inventory/${eventId}/seats?limit=${SEAT_PAGE_LIMIT}` +
          (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`seats ${res.status}`);
        const page = (await res.json()) as {
          items?: Array<{ seatId?: string | null; status?: string }>;
          nextCursor?: string | null;
        };
        if (cancelled) return;

        const seen = deltaSeenRef.current;
        const statuses = statusRef.current;
        for (const item of page.items ?? []) {
          // seatId null = admisión general: cuenta para el aforo pero no hay
          // butaca que pintar.
          if (!item.seatId) continue;
          if (seen.has(item.seatId)) continue;
          statuses.set(item.seatId, ticketStatusToSeatStatus(item.status));
        }
        loaded += page.items?.length ?? 0;
        setLoadedTickets(loaded);
        scheduleBump();
        cursor = page.nextCursor ?? null;

        // Ceder el hilo entre páginas: con 23 páginas seguidas el parseo de
        // JSON solo ya bastaría para que la UI dejara de responder.
        if (cursor) await new Promise((r) => setTimeout(r, 0));
      } while (cursor && !cancelled && !controller.signal.aborted);

      if (!cancelled) setLoadingDetail(false);
    }

    function openStream(since?: string) {
      try {
        // `since` viaja como query aunque el stream de hoy mantenga su propio
        // cursor en servidor: es el cursor que documenta el contrato y deja la
        // ruta lista si el API lo empieza a leer. La garantía real de «sin
        // hueco» la da abrir el stream antes de paginar + `deltaSeenRef`.
        const url =
          `${API}/inventory/${eventId}/stream` +
          (since ? `?since=${encodeURIComponent(since)}` : '');
        es = new EventSource(url);
      } catch {
        setLive(false);
        return;
      }
      es.onopen = () => {
        if (!cancelled) {
          setLive(true);
          lastStreamAt = Date.now();
        }
      };
      es.onerror = () => {
        if (!cancelled) setLive(false);
      };
      // El API emite eventos SIN nombre: `onmessage` es el handler correcto.
      es.onmessage = (event) => {
        if (cancelled) return;
        lastStreamAt = Date.now();
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        const msg = payload as {
          type?: string;
          truncated?: boolean;
          changes?: Array<{ seatId?: string | null; status?: string }>;
        };
        // Los heartbeat sólo existen para que los proxies no maten la conexión.
        if (msg.type !== 'delta') return;
        if (msg.truncated) {
          // El tick se cortó en 2000 cambios: hay agujeros, no hay forma de
          // parchear incrementalmente.
          lastResyncRef.current = 0;
          resync();
          return;
        }
        const seen = deltaSeenRef.current;
        const statuses = statusRef.current;
        let touched = 0;
        for (const change of msg.changes ?? []) {
          if (!change.seatId) continue;
          seen.add(change.seatId);
          statuses.set(change.seatId, ticketStatusToSeatStatus(change.status));
          touched += 1;
        }
        if (touched) scheduleBump();
      };
    }

    async function boot() {
      try {
        const snapshot = await loadAggregates();
        if (cancelled) return;
        // Stream primero, páginas después: ver nota de orden arriba.
        openStream(snapshot?.since);
        await loadSeatPages();
      } catch (err) {
        if (cancelled || (err as Error)?.name === 'AbortError') return;
        setLoadingDetail(false);
        setError(
          `No pudimos cargar la disponibilidad del evento. Revisa tu conexión; reintentamos cada ${
            POLL_MS / 1000
          } segundos.`,
        );
      }
    }

    // Al resincronizar, las páginas vuelven a ser la verdad de base.
    deltaSeenRef.current = new Set();
    void boot();

    pollTimer = window.setInterval(() => {
      if (cancelled) return;
      void loadAggregates().catch(() => {
        if (!cancelled) {
          setError('Perdimos contacto con el servidor. Los conteos pueden estar desfasados.');
        }
      });
      // El poll mantiene vivos los agregados, pero si el stream lleva mucho
      // caído el detalle por butaca ya no vale: ahí sí toca repaginar (una vez
      // por minuto como mucho).
      if (Date.now() - lastStreamAt > STALE_STREAM_MS) resync();
    }, POLL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      es?.close();
      if (pollTimer != null) window.clearInterval(pollTimer);
      if (bumpTimerRef.current != null) {
        window.clearTimeout(bumpTimerRef.current);
        bumpTimerRef.current = null;
      }
    };
  }, [eventId, resyncNonce, scheduleBump, resync]);

  return {
    statusRef,
    version,
    aggregates,
    loadedTickets,
    loadingDetail,
    live,
    error,
    resync,
  };
}
