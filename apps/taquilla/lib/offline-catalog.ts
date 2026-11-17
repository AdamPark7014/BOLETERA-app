import { STORE_CATALOG, STORE_QUOTA, idbAvailable, idbGet, idbPut } from './idb';

/**
 * Catálogo y cupo de venta sin red.
 * El manifiesto de puerta vive en `manifest.ts`; esto es solo para cobrar
 * tras recargar la PWA sin conexión.
 */

const CATALOG_ID = 'events';

export type OfflineCatalogEvent = {
  id: string;
  title: string;
  startsAt: string;
  category?: string | null;
  venue?: { name: string };
  offers?: Array<Record<string, unknown>>;
};

type CatalogRow = { id: string; events: OfflineCatalogEvent[]; savedAt: string };

export type OfflineQuotaRow = {
  eventId: string;
  available: number;
  byOffer: Record<string, number>;
  updatedAt: string;
};

export async function saveOfflineCatalog(events: OfflineCatalogEvent[]): Promise<void> {
  if (!idbAvailable()) return;
  const row: CatalogRow = {
    id: CATALOG_ID,
    events,
    savedAt: new Date().toISOString(),
  };
  await idbPut<CatalogRow>(STORE_CATALOG, row);
}

export async function loadOfflineCatalog(): Promise<OfflineCatalogEvent[]> {
  if (!idbAvailable()) return [];
  const row = await idbGet<CatalogRow>(STORE_CATALOG, CATALOG_ID).catch(() => undefined);
  return Array.isArray(row?.events) ? row!.events : [];
}

export async function saveOfflineQuota(
  eventId: string,
  available: number,
  byOffer: Record<string, number>
): Promise<void> {
  if (!idbAvailable()) return;
  const row: OfflineQuotaRow = {
    eventId,
    available,
    byOffer,
    updatedAt: new Date().toISOString(),
  };
  await idbPut<OfflineQuotaRow>(STORE_QUOTA, row);
}

export async function loadOfflineQuota(eventId: string): Promise<OfflineQuotaRow | undefined> {
  if (!idbAvailable()) return undefined;
  return idbGet<OfflineQuotaRow>(STORE_QUOTA, eventId).catch(() => undefined);
}

/** Descuenta cupo local; false si no alcanza. */
export async function reserveOfflineQuota(eventId: string, qty: number): Promise<boolean> {
  if (!idbAvailable() || qty < 1) return false;
  const current = await loadOfflineQuota(eventId);
  if (!current || current.available < qty) return false;
  await saveOfflineQuota(eventId, current.available - qty, current.byOffer);
  return true;
}
