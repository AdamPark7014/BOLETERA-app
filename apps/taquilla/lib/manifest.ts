import { apiJson } from './auth';
import {
  STORE_LOCAL_SCANS,
  STORE_MANIFEST,
  STORE_MANIFEST_META,
  idbBulkPut,
  idbGet,
  idbGetAll,
  idbPut,
  idbAvailable,
} from './idb';

/**
 * Manifiesto de evento para operar la puerta SIN RED.
 *
 * QUÉ GARANTIZA (y sólo esto):
 *  · Pertenencia: el id del boleto estaba en el evento cuando se emitió el
 *    manifiesto (`issuedAt`).
 *  · Estado en ese instante: 'S' vendido/válido, 'U' ya usado.
 *  · Duplicados locales: dos pasadas del MISMO boleto en ESTE dispositivo.
 *
 * QUÉ NO GARANTIZA (hay que decirlo en pantalla, no esconderlo):
 *  · NO verifica la firma rotativa del QR. El secreto vive en el servidor; sin
 *    red no se puede distinguir un QR legítimo de uno fabricado con un id
 *    válido copiado de otro boleto.
 *  · NO conoce reembolsos, anulaciones ni transferencias posteriores a
 *    `issuedAt`. Un boleto cancelado después de la descarga se ve como válido.
 *  · NO detecta duplicados de OTRA puerta también sin red: eso sólo aparece en
 *    `conflicts` al sincronizar.
 *  · NO valida la firma del manifiesto en el dispositivo (mismo motivo: no
 *    tenemos el secreto). Se guarda tal cual para poder auditarla después.
 *  · La entrada MANUAL de código (`ticketCode`) no se puede resolver sin red:
 *    el manifiesto lleva ids de boleto, no códigos impresos. Sin red sólo sirve
 *    el escaneo de QR.
 */

export type ManifestEntry = {
  /** id del boleto (== `t` del payload QR). */
  id: string;
  /** 'S' vendido/válido · 'U' ya usado al emitir el manifiesto. */
  st: 'S' | 'U';
  /** Huella del servidor; se conserva para conciliación, no se verifica aquí. */
  h: string;
  eventId: string;
};

export type ManifestMeta = {
  eventId: string;
  eventTitle?: string;
  issuedAt: string;
  downloadedAt: string;
  count: number;
  /** Firma de la ÚLTIMA página; el servidor firma por página. */
  signature: string;
  complete: boolean;
};

type ManifestPage = {
  v: number;
  eventId: string;
  issuedAt: string;
  count: number;
  nextCursor: string | null;
  entries: Array<{ id: string; st: 'S' | 'U'; h: string }>;
  signature: string;
};

export type LocalScan = {
  ticketId: string;
  eventId: string;
  scannedAt: string;
  zoneId?: string;
  /** Resultado que se le mostró al operador en la puerta. */
  outcome: 'ok' | 'duplicate' | 'unknown';
};

const MANIFEST_PAGE_LIMIT = 2000;
const MAX_MANIFEST_PAGES = 60;

/** Descarga el manifiesto completo y lo guarda en IndexedDB. */
export async function downloadManifest(
  eventId: string,
  opts: { eventTitle?: string; onProgress?: (loaded: number) => void } = {},
): Promise<ManifestMeta> {
  if (!idbAvailable()) throw new Error('Este navegador no permite almacenamiento offline');
  let cursor: string | null = null;
  let loaded = 0;
  let issuedAt = new Date().toISOString();
  let signature = '';
  let complete = false;

  for (let page = 0; page < MAX_MANIFEST_PAGES; page += 1) {
    const qs = new URLSearchParams({ limit: String(MANIFEST_PAGE_LIMIT) });
    if (cursor) qs.set('cursor', cursor);
    const data = await apiJson<ManifestPage>(
      `/access/events/${encodeURIComponent(eventId)}/manifest?${qs.toString()}`,
    );
    await idbBulkPut<ManifestEntry>(
      STORE_MANIFEST,
      data.entries.map((e) => ({ ...e, eventId })),
    );
    loaded += data.entries.length;
    issuedAt = data.issuedAt;
    signature = data.signature;
    opts.onProgress?.(loaded);
    cursor = data.nextCursor;
    if (!cursor) {
      complete = true;
      break;
    }
  }

  const meta: ManifestMeta = {
    eventId,
    eventTitle: opts.eventTitle,
    issuedAt,
    downloadedAt: new Date().toISOString(),
    count: loaded,
    signature,
    complete,
  };
  await idbPut(STORE_MANIFEST_META, meta);
  return meta;
}

export function getManifestMeta(eventId: string): Promise<ManifestMeta | undefined> {
  if (!idbAvailable()) return Promise.resolve(undefined);
  return idbGet<ManifestMeta>(STORE_MANIFEST_META, eventId).catch(() => undefined);
}

export function listManifests(): Promise<ManifestMeta[]> {
  if (!idbAvailable()) return Promise.resolve([]);
  return idbGetAll<ManifestMeta>(STORE_MANIFEST_META).catch(() => []);
}

export function lookupManifestEntry(ticketId: string): Promise<ManifestEntry | undefined> {
  if (!idbAvailable()) return Promise.resolve(undefined);
  return idbGet<ManifestEntry>(STORE_MANIFEST, ticketId).catch(() => undefined);
}

export function getLocalScan(ticketId: string): Promise<LocalScan | undefined> {
  if (!idbAvailable()) return Promise.resolve(undefined);
  return idbGet<LocalScan>(STORE_LOCAL_SCANS, ticketId).catch(() => undefined);
}

export function recordLocalScan(scan: LocalScan): Promise<void> {
  if (!idbAvailable()) return Promise.resolve();
  return idbPut(STORE_LOCAL_SCANS, scan).catch(() => undefined);
}

/**
 * El QR es JSON compacto `{v,t,e,s}`. Se parsea en local sólo para sacar el id
 * del boleto: la firma `s` NO se comprueba aquí (no tenemos el secreto).
 */
export function parseQrPayload(raw: string): { ticketId: string; eventId: string } | null {
  const text = raw.trim();
  if (!text.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text) as { t?: unknown; e?: unknown };
    if (typeof parsed.t !== 'string' || typeof parsed.e !== 'string') return null;
    return { ticketId: parsed.t, eventId: parsed.e };
  } catch {
    return null;
  }
}
