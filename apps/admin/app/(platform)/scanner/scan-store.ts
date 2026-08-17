/**
 * Persistencia local de la estación de escaneo.
 *
 * Todo vive en `localStorage` para que la terminal siga operando sin red y
 * conserve el historial entre recargas. Ninguna de estas funciones toca React:
 * el hook `useScanStation` es el único que las orquesta.
 */

import type { QueuedScan, ScanRecord, ScanSource, ScanTicketInfo, ScanVerdict } from './types';

const QUEUE_KEY = 'boletera_offline_scans';
const LOG_KEY = 'boletera_scan_log';
const STATION_KEY = 'boletera_scan_station';
const SOUND_KEY = 'boletera_scan_sound';

/** Límite del historial local para no crecer sin control en jornadas largas. */
export const LOG_LIMIT = 250;

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createId(): string {
  const cryptoApi = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseArray(key: string): unknown[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJson(key: string, value: unknown): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    /* cuota agotada o modo privado: la operación sigue en memoria */
  }
}

function toSource(value: unknown): ScanSource {
  return value === 'camera' || value === 'queue' ? value : 'manual';
}

function toVerdict(value: unknown): ScanVerdict | null {
  return value === 'approved' || value === 'rejected' || value === 'queued' ? value : null;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function toTicket(value: unknown): ScanTicketInfo | undefined {
  if (!isObject(value)) return undefined;
  const code = value.code;
  const eventTitle = value.eventTitle;
  if (typeof code !== 'string') return undefined;
  return {
    code,
    eventTitle: typeof eventTitle === 'string' ? eventTitle : '',
    section: toOptionalString(value.section) ?? null,
    row: toOptionalString(value.row) ?? null,
    seatNumber: toOptionalString(value.seatNumber) ?? null,
  };
}

function toQueuedScan(value: unknown): QueuedScan | null {
  if (!isObject(value)) return null;
  const raw = value.raw;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return {
    id: toOptionalString(value.id) ?? createId(),
    raw,
    at: toOptionalString(value.at) ?? new Date().toISOString(),
    station: typeof value.station === 'string' ? value.station : '',
    source: toSource(value.source),
  };
}

function toScanRecord(value: unknown): ScanRecord | null {
  if (!isObject(value)) return null;
  const raw = value.raw;
  const verdict = toVerdict(value.verdict);
  if (typeof raw !== 'string' || !verdict) return null;
  const latency = value.latencyMs;
  return {
    id: toOptionalString(value.id) ?? createId(),
    raw,
    verdict,
    at: toOptionalString(value.at) ?? new Date().toISOString(),
    source: toSource(value.source),
    station: typeof value.station === 'string' ? value.station : '',
    ticket: toTicket(value.ticket),
    reason: toOptionalString(value.reason),
    latencyMs: typeof latency === 'number' && Number.isFinite(latency) ? latency : undefined,
  };
}

export function readQueue(): QueuedScan[] {
  return parseArray(QUEUE_KEY)
    .map(toQueuedScan)
    .filter((item): item is QueuedScan => item !== null);
}

export function writeQueue(items: readonly QueuedScan[]): void {
  writeJson(QUEUE_KEY, items);
}

export function readLog(): ScanRecord[] {
  return parseArray(LOG_KEY)
    .map(toScanRecord)
    .filter((item): item is ScanRecord => item !== null)
    .slice(0, LOG_LIMIT);
}

export function writeLog(items: readonly ScanRecord[]): void {
  writeJson(LOG_KEY, items.slice(0, LOG_LIMIT));
}

export function readStation(): string {
  return storage()?.getItem(STATION_KEY) ?? '';
}

export function writeStation(value: string): void {
  const store = storage();
  if (!store) return;
  try {
    if (value.trim()) store.setItem(STATION_KEY, value.trim());
    else store.removeItem(STATION_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}

export function readSoundEnabled(): boolean {
  return storage()?.getItem(SOUND_KEY) !== 'off';
}

export function writeSoundEnabled(enabled: boolean): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(SOUND_KEY, enabled ? 'on' : 'off');
  } catch {
    /* almacenamiento no disponible */
  }
}

const HIGH_VIS_KEY = 'boletera_scanner_high_vis';

export function readHighVisibility(): boolean {
  return storage()?.getItem(HIGH_VIS_KEY) === '1';
}

export function writeHighVisibility(enabled: boolean): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(HIGH_VIS_KEY, enabled ? '1' : '0');
  } catch {
    /* almacenamiento no disponible */
  }
}

/** Construye el cuerpo de `/access/scan` según el contenido escaneado. */
export function scanBody(raw: string): { ticketCode: string } | { qrPayload: string } {
  const value = raw.trim();
  return value.startsWith('{') ? { qrPayload: value } : { ticketCode: value };
}
