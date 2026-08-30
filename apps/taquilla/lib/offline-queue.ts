import type { OfflinePosPayload } from './pos';
import { pushFailedSync } from './pos';
import { STORE_SALES, idbAvailable, idbCount, idbDelete, idbGetAll, idbPut } from './idb';

/**
 * Cola de ventas hechas sin red.
 *
 * Ahora usa el helper compartido de IndexedDB: antes abría la base con su
 * propia versión y cualquier almacén nuevo (manifiestos, escaneos) la habría
 * dejado inservible con un VersionError.
 */

export interface QueuedSale {
  id: string;
  payload: OfflinePosPayload | Record<string, unknown>;
  createdAt: string;
}

export async function enqueueSale(
  payload: OfflinePosPayload | Record<string, unknown>,
): Promise<void> {
  if (!idbAvailable()) return;
  const id =
    (payload as OfflinePosPayload).clientSaleId ||
    (typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Date.now()));
  // Always stamp a stable id so sync can hit Order.(organizationId, clientSaleId).
  const stamped: OfflinePosPayload | Record<string, unknown> = {
    ...payload,
    clientSaleId: id,
    checkoutData: {
      ...((payload as OfflinePosPayload).checkoutData || {}),
      clientSaleId: id,
    },
  };
  await idbPut<QueuedSale>(STORE_SALES, {
    id,
    payload: stamped,
    createdAt: new Date().toISOString(),
  });
}

export async function getQueueSize(): Promise<number> {
  if (!idbAvailable()) return 0;
  return idbCount(STORE_SALES).catch(() => 0);
}

/**
 * Envía la cola una a una. Un fallo NO detiene el resto: antes bastaba una
 * venta rechazada por el API para dejar bloqueadas todas las demás del turno.
 * Lo que falla se apunta en `failedSync` y se reintenta en la siguiente vuelta.
 */
export async function flushQueue(
  send: (payload: QueuedSale['payload']) => Promise<void>,
): Promise<number> {
  if (!idbAvailable()) return 0;
  const all = await idbGetAll<QueuedSale>(STORE_SALES).catch(() => [] as QueuedSale[]);
  let count = 0;
  for (const sale of all) {
    try {
      await send(sale.payload);
      await idbDelete(STORE_SALES, sale.id);
      count += 1;
    } catch (e) {
      pushFailedSync({
        clientSaleId: sale.id,
        error: e instanceof Error ? e.message : 'sync failed',
      });
      // Sin red no tiene sentido seguir intentando el resto del lote.
      if (typeof navigator !== 'undefined' && !navigator.onLine) break;
    }
  }
  return count;
}
