'use client';

/**
 * Cliente del inventario de un evento.
 *
 * El contrato cambió y el admin se quedó atrás: `/inventory/:eventId/availability`
 * ya NO devuelve `tickets[]`. Devuelve totales agregados; el detalle butaca a
 * butaca sale de `/inventory/:eventId/seats` paginado (máximo 2000 por página) y
 * las variaciones en vivo del SSE de deltas. Cargar 45.000 boletos en una sola
 * respuesta era justo lo que había que dejar de hacer.
 *
 * Vive fuera de `lib/` a propósito: `lib/platform-api.ts` es propiedad de otra
 * parte del equipo en esta tanda.
 */

import { adminApi, type AdminApiOptions } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://127.0.0.1:4000/api/v1';

/** `TicketStatus` de Prisma. No existe `BLOCKED`: un bloqueo es un hold. */
export const SEAT_STATUSES = [
  'AVAILABLE',
  'HELD',
  'SOLD',
  'USED',
  'REFUNDED',
  'TRANSFERRED',
  'RESOLD',
  'EXPIRED',
] as const;
export type SeatStatus = (typeof SEAT_STATUSES)[number];

export const SEAT_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: 'Disponible',
  HELD: 'En hold',
  SOLD: 'Vendido',
  USED: 'Usado',
  REFUNDED: 'Reembolsado',
  TRANSFERRED: 'Transferido',
  RESOLD: 'Reventa',
  EXPIRED: 'Expirado',
};

/** Estados que ya no se pueden volver a vender. */
export const CONSUMED_STATUSES: SeatStatus[] = ['SOLD', 'USED', 'TRANSFERRED', 'RESOLD'];

export type AvailabilitySnapshot = {
  eventId: string;
  generatedAt: string;
  /** Marca de la que arranca el SSE para no perder cambios entre carga y stream. */
  since: string;
  totalTickets: number;
  totals: Record<string, number>;
  byOffer: { offerId: string; total: number; counts: Record<string, number> }[];
  activeHolds: number;
};

export type InventorySeat = {
  id: string;
  seatId: string | null;
  offerId: string;
  status: SeatStatus | string;
  section: string | null;
  row: string | null;
  seatNumber: string | null;
};

export type SeatPage = {
  eventId: string;
  items: InventorySeat[];
  limit: number;
  nextCursor: string | null;
};

export type InventoryDelta = {
  type: 'delta';
  eventId: string;
  since: string;
  until: string;
  /** El servidor cortó en 2000 cambios: el recuento local quedó corto, hay que releer. */
  truncated: boolean;
  changes: { id: string; seatId: string | null; offerId: string; status: SeatStatus | string }[];
};

export type InventoryHeartbeat = { type: 'heartbeat'; eventId: string; at: string };
export type InventoryStreamMessage = InventoryDelta | InventoryHeartbeat;

function query(params: Record<string, string | number | undefined | null>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/* ── Lectura de inventario (rutas públicas del API) ───────────────────────── */

export function getAvailability(
  token: string,
  eventId: string,
  opts?: { since?: string; signal?: AbortSignal; silent?: boolean },
) {
  const init: AdminApiOptions = { signal: opts?.signal, silent: opts?.silent };
  return adminApi<AvailabilitySnapshot>(
    `/inventory/${encodeURIComponent(eventId)}/availability${query({ since: opts?.since })}`,
    token,
    init,
  );
}

/** Tope duro del servidor: pedir más se recorta, no amplía la página. */
export const SEAT_PAGE_MAX = 2000;

export function getSeatPage(
  token: string,
  eventId: string,
  params?: { cursor?: string | null; limit?: number; status?: string; signal?: AbortSignal },
) {
  return adminApi<SeatPage>(
    `/inventory/${encodeURIComponent(eventId)}/seats${query({
      cursor: params?.cursor,
      limit: Math.min(params?.limit ?? SEAT_PAGE_MAX, SEAT_PAGE_MAX),
      status: params?.status,
    })}`,
    token,
    { signal: params?.signal },
  );
}

/**
 * Recorre todas las páginas de butacas informando del avance.
 *
 * Con 45.000 boletos son 23 vueltas; sin `onPage` la pantalla se quedaría muda
 * media docena de segundos. El tope de páginas evita que un `nextCursor` que no
 * avanza convierta esto en un bucle infinito contra producción.
 */
export async function loadAllSeats(
  token: string,
  eventId: string,
  opts?: {
    status?: string;
    signal?: AbortSignal;
    onPage?: (items: InventorySeat[], loadedTotal: number) => void;
    maxPages?: number;
  },
): Promise<InventorySeat[]> {
  const all: InventorySeat[] = [];
  let cursor: string | null = null;
  const maxPages = opts?.maxPages ?? 40;

  for (let page = 0; page < maxPages; page++) {
    if (opts?.signal?.aborted) break;
    const res: SeatPage = await getSeatPage(token, eventId, {
      cursor,
      status: opts?.status,
      signal: opts?.signal,
    });
    const items = res.items ?? [];
    all.push(...items);
    opts?.onPage?.(items, all.length);
    if (!res.nextCursor || res.nextCursor === cursor || items.length === 0) break;
    cursor = res.nextCursor;
  }
  return all;
}

/**
 * URL del SSE de deltas.
 *
 * La ruta es pública precisamente porque `EventSource` no admite cabeceras, así
 * que aquí no viaja el token. Ver `apps/taquilla/lib/inventory.ts`, que documenta
 * la misma restricción.
 */
export function inventoryStreamUrl(eventId: string) {
  return `${API_BASE}/inventory/${encodeURIComponent(eventId)}/stream`;
}

/* ── Holds de personal (JWT + rol TAQUILLA/ADMIN/SUPER_ADMIN/VENUE_MANAGER) ── */

export type SeatHoldRow = {
  id: string;
  eventId?: string;
  ticketId?: string;
  status?: string;
  expiresAt?: string;
};

export type StaffHoldResult = { holds: SeatHoldRow[]; expiresAt: string };

export type BestAvailableResult = StaffHoldResult & {
  mode: 'RESERVED' | 'GA';
  seats: { seatId: string; section: string; row: string; seatNumber: string; label: string }[];
};

/** El servidor limita los holds de personal a 100 boletos por operación. */
export const STAFF_HOLD_MAX_SEATS = 100;

export function createStaffHold(
  token: string,
  body: { eventId: string; seatIds?: string[]; offerId?: string; quantity?: number; sessionId?: string },
) {
  return adminApi<StaffHoldResult>('/inventory/staff/holds', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** `quantity` se recorta a 1..12 en el servidor. */
export const BEST_AVAILABLE_MAX = 12;

export function createBestAvailableHold(
  token: string,
  body: { eventId: string; offerId: string; quantity: number; contiguous?: boolean; sessionId?: string },
) {
  return adminApi<BestAvailableResult>('/inventory/staff/holds/best-available', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function releaseStaffHold(token: string, holdId: string) {
  return adminApi<{ released: boolean; reason?: string }>(
    `/inventory/staff/holds/${encodeURIComponent(holdId)}`,
    token,
    { method: 'DELETE' },
  );
}

/* ── Bloqueos administrativos con motivo obligatorio ──────────────────────── */

export const BLOCK_CATEGORIES = [
  'CORTESIA',
  'PRODUCCION',
  'INCIDENCIA',
  'FRAUDE',
  'TECNICO',
  'OTRO',
] as const;
export type BlockCategory = (typeof BLOCK_CATEGORIES)[number];

export const BLOCK_CATEGORY_LABEL: Record<BlockCategory, string> = {
  CORTESIA: 'Cortesía',
  PRODUCCION: 'Producción',
  INCIDENCIA: 'Incidencia',
  FRAUDE: 'Fraude',
  TECNICO: 'Técnico',
  OTRO: 'Otro',
};

/** El servidor rechaza motivos de menos de 8 caracteres tras recortar espacios. */
export const MIN_REASON_LENGTH = 8;

export function reasonError(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) return 'El motivo es obligatorio: queda en la bitácora de auditoría.';
  if (trimmed.length < MIN_REASON_LENGTH)
    return `Faltan ${MIN_REASON_LENGTH - trimmed.length} caracteres: el motivo debe explicar el bloqueo (mínimo ${MIN_REASON_LENGTH}).`;
  return null;
}

export type AdminBlockResult = {
  holds: SeatHoldRow[];
  expiresAt: string;
  reason: string;
  category: string;
};

export function blockSeats(
  token: string,
  layoutId: string,
  body: {
    eventId: string;
    seatIds: string[];
    reason: string;
    category?: BlockCategory;
    sessionId?: string;
  },
) {
  return adminApi<AdminBlockResult>(`/layouts/${encodeURIComponent(layoutId)}/seats/hold`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export type AdminReleaseResult = {
  requested: number;
  released: number;
  notActive: number;
  failed: string[];
  reason: string;
  category: string;
};

export function releaseSeats(
  token: string,
  layoutId: string,
  body: { seatIds: string[]; reason: string; category?: BlockCategory },
) {
  return adminApi<AdminReleaseResult>(`/layouts/${encodeURIComponent(layoutId)}/seats/release`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/* ── Derivados para la interfaz ───────────────────────────────────────────── */

export function countOf(snapshot: AvailabilitySnapshot | null, status: string): number {
  return Number(snapshot?.totals?.[status] ?? 0);
}

/** Ocupación = butacas que ya no se pueden volver a vender sobre el total emitido. */
export function occupancyPercent(snapshot: AvailabilitySnapshot | null): number {
  if (!snapshot || !snapshot.totalTickets) return 0;
  const taken = CONSUMED_STATUSES.reduce((sum, s) => sum + countOf(snapshot, s), 0);
  return Math.round((taken / snapshot.totalTickets) * 1000) / 10;
}

export function soldCount(snapshot: AvailabilitySnapshot | null): number {
  return CONSUMED_STATUSES.reduce((sum, s) => sum + countOf(snapshot, s), 0);
}

/**
 * Aplica los cambios del SSE sobre los totales que ya tenemos.
 *
 * El stream manda solo lo que cambió; recalcular con un `availability` completo
 * en cada latido serían 20 peticiones por minuto por pestaña abierta. El total
 * emitido no cambia con un delta, solo su reparto entre estados.
 */
export function applyDelta(
  totals: Record<string, number>,
  statusById: Map<string, string>,
  changes: InventoryDelta['changes'],
): { totals: Record<string, number>; newlySold: number } {
  const next = { ...totals };
  let newlySold = 0;

  for (const change of changes) {
    const prev = statusById.get(change.id);
    if (prev === change.status) continue;
    if (prev) next[prev] = Math.max(0, (next[prev] ?? 0) - 1);
    next[change.status] = (next[change.status] ?? 0) + 1;
    if (!prev || !CONSUMED_STATUSES.includes(prev as SeatStatus)) {
      if (CONSUMED_STATUSES.includes(change.status as SeatStatus)) newlySold++;
    }
    statusById.set(change.id, change.status);
  }

  return { totals: next, newlySold };
}
