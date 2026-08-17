import { apiJson } from './auth';
import {
  STORE_CONFLICTS,
  STORE_SCAN_QUEUE,
  idbAvailable,
  idbBulkDelete,
  idbBulkPut,
  idbClear,
  idbCount,
  idbGetAll,
  idbPut,
} from './idb';

/**
 * Cola de escaneos hechos sin red y su conciliación con
 * `POST /access/scans/sync`.
 *
 * El API nunca falla el lote entero por un duplicado: devuelve
 * `{ applied, conflicts[], rejected[] }`. Los conflictos NO se ocultan — se
 * guardan y se muestran hasta que operaciones los marca como revisados.
 */

/** Tope del API. */
export const SYNC_BATCH_SIZE = 500;

export type QueuedScan = {
  /** ticketId + instante: dos pasadas del mismo boleto no se pisan en la cola. */
  id: string;
  ticketId: string;
  eventId: string;
  scannedAt: string;
  zoneId?: string;
};

export type ScanConflict = {
  id: string;
  ticketId: string;
  attemptedAt: string;
  attemptedZoneId?: string;
  firstScanAt: string | null;
  firstScanZoneId: string | null;
  firstScanBy: string | null;
  /** 'conflict' = ya estaba usado · 'rejected' = el API lo descartó. */
  kind: 'conflict' | 'rejected';
  reason?: string;
  seenAt: string;
};

type SyncResponse = {
  applied?: number;
  accepted?: Array<{ ticketId: string; scannedAt: string }>;
  conflicts?: Array<{
    ticketId: string;
    attemptedAt: string;
    attemptedZoneId?: string;
    firstScanAt: string | null;
    firstScanZoneId: string | null;
    firstScanBy: string | null;
  }>;
  rejected?: Array<{ ticketId: string; reason: string }>;
};

export type SyncOutcome = {
  sent: number;
  applied: number;
  conflicts: number;
  rejected: number;
};

export function enqueueScan(scan: Omit<QueuedScan, 'id'>): Promise<void> {
  if (!idbAvailable()) return Promise.resolve();
  const id = `${scan.ticketId}:${scan.scannedAt}`;
  return idbPut<QueuedScan>(STORE_SCAN_QUEUE, { ...scan, id }).catch(() => undefined);
}

export function pendingScanCount(): Promise<number> {
  if (!idbAvailable()) return Promise.resolve(0);
  return idbCount(STORE_SCAN_QUEUE).catch(() => 0);
}

export function listConflicts(): Promise<ScanConflict[]> {
  if (!idbAvailable()) return Promise.resolve([]);
  return idbGetAll<ScanConflict>(STORE_CONFLICTS).catch(() => []);
}

export function clearConflicts(): Promise<void> {
  if (!idbAvailable()) return Promise.resolve();
  return idbClear(STORE_CONFLICTS).catch(() => undefined);
}

/**
 * Vacía la cola en lotes de 500. Un lote sólo se borra de la cola cuando el API
 * responde: si se corta la red a medias, los pendientes siguen ahí.
 *
 * Los escaneos que el API marca como conflicto o rechazo SÍ salen de la cola
 * (reintentarlos daría el mismo resultado para siempre) y pasan al almacén de
 * conflictos para revisión humana.
 */
export async function syncScans(zoneFallback?: string): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { sent: 0, applied: 0, conflicts: 0, rejected: 0 };
  if (!idbAvailable()) return outcome;

  for (;;) {
    const batch = await idbGetAll<QueuedScan>(STORE_SCAN_QUEUE, SYNC_BATCH_SIZE);
    if (!batch.length) break;

    const data = await apiJson<SyncResponse>('/access/scans/sync', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'TAQUILLA',
        scans: batch.map((s) => ({
          ticketId: s.ticketId,
          scannedAt: s.scannedAt,
          zoneId: s.zoneId ?? zoneFallback,
        })),
      }),
    });

    const seenAt = new Date().toISOString();
    const conflicts: ScanConflict[] = (data.conflicts ?? []).map((c) => ({
      id: `${c.ticketId}:${c.attemptedAt}`,
      ticketId: c.ticketId,
      attemptedAt: c.attemptedAt,
      attemptedZoneId: c.attemptedZoneId,
      firstScanAt: c.firstScanAt,
      firstScanZoneId: c.firstScanZoneId,
      firstScanBy: c.firstScanBy,
      kind: 'conflict',
      seenAt,
    }));
    const rejected: ScanConflict[] = (data.rejected ?? []).map((r) => ({
      id: `rej:${r.ticketId}:${seenAt}`,
      ticketId: r.ticketId,
      attemptedAt: seenAt,
      firstScanAt: null,
      firstScanZoneId: null,
      firstScanBy: null,
      kind: 'rejected',
      reason: r.reason,
      seenAt,
    }));
    await idbBulkPut<ScanConflict>(STORE_CONFLICTS, [...conflicts, ...rejected]);
    await idbBulkDelete(
      STORE_SCAN_QUEUE,
      batch.map((s) => s.id),
    );

    outcome.sent += batch.length;
    outcome.applied += data.applied ?? data.accepted?.length ?? 0;
    outcome.conflicts += conflicts.length;
    outcome.rejected += rejected.length;

    if (batch.length < SYNC_BATCH_SIZE) break;
  }
  return outcome;
}
