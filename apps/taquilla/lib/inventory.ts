import { apiJson, getApiBase } from './auth';

/**
 * Inventario contra el contrato nuevo del API.
 *
 * `GET /inventory/:eventId/availability` ya NO devuelve `tickets[]`: son conteos
 * agregados. El detalle por butaca vive en `/seats` paginado y el SSE emite
 * DELTAS, no snapshots. La taquilla leía `data.tickets` y por eso pintaba todas
 * las butacas como libres — vendiendo asientos ya vendidos.
 */

export type AvailabilitySnapshot = {
  eventId: string;
  generatedAt: string;
  since: string;
  totalTickets: number;
  totals: Record<string, number>;
  byOffer: Array<{ offerId: string; total: number; counts: Record<string, number> }>;
  activeHolds: number;
};

export type SeatRow = {
  id: string;
  seatId: string | null;
  offerId: string;
  status: string;
  section?: string | null;
  row?: string | null;
  seatNumber?: string | null;
};

export type SeatPage = {
  eventId: string;
  items: SeatRow[];
  limit: number;
  nextCursor: string | null;
};

export type InventoryDelta = {
  type: 'delta';
  since: string;
  until: string;
  truncated?: boolean;
  changes: Array<{ id: string; seatId: string | null; offerId: string; status: string }>;
};

export type InventoryHeartbeat = { type: 'heartbeat'; eventId: string; at: string };

const SEAT_PAGE_LIMIT = 1000;
/** Tope de páginas por barrido: un recinto de 45.000 butacas son 45 peticiones. */
const MAX_SEAT_PAGES = 60;

export function fetchAvailability(eventId: string) {
  return apiJson<AvailabilitySnapshot>(`/inventory/${encodeURIComponent(eventId)}/availability`);
}

export function fetchSeatPage(eventId: string, cursor?: string | null, limit = SEAT_PAGE_LIMIT) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  return apiJson<SeatPage>(`/inventory/${encodeURIComponent(eventId)}/seats?${qs.toString()}`);
}

/** Disponibilidad libre por oferta, derivada del agregado nuevo. */
export function availableByOffer(snapshot: AvailabilitySnapshot): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of snapshot.byOffer) out[row.offerId] = row.counts.AVAILABLE ?? 0;
  return out;
}

export function totalAvailable(snapshot: AvailabilitySnapshot): number {
  return snapshot.totals.AVAILABLE ?? 0;
}

/**
 * Recorre TODAS las páginas de butacas y devuelve el estado por `seatId`.
 * Se usa una sola vez al abrir el mapa; a partir de ahí manda el SSE de deltas.
 */
export async function loadSeatStatuses(
  eventId: string,
  signal?: { cancelled: boolean },
): Promise<Record<string, string>> {
  const statuses: Record<string, string> = {};
  let cursor: string | null = null;
  for (let page = 0; page < MAX_SEAT_PAGES; page += 1) {
    if (signal?.cancelled) break;
    const data: SeatPage = await fetchSeatPage(eventId, cursor);
    for (const item of data.items) {
      if (item.seatId) statuses[item.seatId] = item.status.toLowerCase();
    }
    cursor = data.nextCursor;
    if (!cursor) break;
  }
  return statuses;
}

/**
 * SSE de deltas. Devuelve la función de cierre.
 *
 * `EventSource` no manda cabeceras, así que esta ruta debe seguir siendo
 * pública (lo es). Si el stream cae se avisa por `onLive(false)` y la pantalla
 * decide si vuelve a barrer las páginas.
 */
export function subscribeInventory(
  eventId: string,
  handlers: {
    onDelta: (delta: InventoryDelta) => void;
    onLive?: (live: boolean) => void;
    onTruncated?: () => void;
  },
): () => void {
  let es: EventSource | null = null;
  try {
    es = new EventSource(`${getApiBase()}/inventory/${encodeURIComponent(eventId)}/stream`);
  } catch {
    handlers.onLive?.(false);
    return () => undefined;
  }
  es.onopen = () => handlers.onLive?.(true);
  es.onerror = () => handlers.onLive?.(false);
  es.onmessage = (event: MessageEvent<string>) => {
    let payload: InventoryDelta | InventoryHeartbeat;
    try {
      payload = JSON.parse(event.data) as InventoryDelta | InventoryHeartbeat;
    } catch {
      return;
    }
    if (payload.type === 'heartbeat') {
      handlers.onLive?.(true);
      return;
    }
    if (payload.type !== 'delta') return;
    // `truncated` significa que el productor se saltó cambios: el snapshot local
    // ya no es de fiar y hay que rebarrer, no seguir aplicando parches.
    if (payload.truncated) handlers.onTruncated?.();
    handlers.onDelta(payload);
  };
  const source = es;
  return () => source.close();
}
