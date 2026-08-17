/**
 * Capa mínima sobre IndexedDB.
 *
 * UNA sola base y UNA sola versión para toda la taquilla. Antes la cola de
 * ventas abría `boletera-taquilla` en la versión 1 por su cuenta; en cuanto otro
 * módulo necesita un almacén nuevo, `indexedDB.open(name, 1)` revienta con
 * VersionError y la terminal pierde la cola offline entera. Todos los almacenes
 * se declaran aquí y se crean en la misma migración.
 */

const DB_NAME = 'boletera-taquilla';
const DB_VERSION = 3;

export const STORE_SALES = 'sales';
export const STORE_SCAN_QUEUE = 'scanQueue';
export const STORE_MANIFEST = 'manifest';
export const STORE_MANIFEST_META = 'manifestMeta';
export const STORE_LOCAL_SCANS = 'localScans';
export const STORE_CONFLICTS = 'scanConflicts';

/** [nombre del almacén, keyPath]. Añadir aquí y subir DB_VERSION. */
const STORES: Array<[string, string]> = [
  [STORE_SALES, 'id'],
  [STORE_SCAN_QUEUE, 'id'],
  [STORE_MANIFEST, 'id'],
  [STORE_MANIFEST_META, 'eventId'],
  [STORE_LOCAL_SCANS, 'ticketId'],
  [STORE_CONFLICTS, 'id'],
];

let dbPromise: Promise<IDBDatabase> | null = null;

export function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function openDb(): Promise<IDBDatabase> {
  if (!idbAvailable()) return Promise.reject(new Error('IndexedDB no disponible'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB error'));
    // Otra pestaña de la terminal con una versión vieja abierta bloquea la
    // migración: es mejor decirlo que quedarse colgado sin cola offline.
    req.onblocked = () => reject(new Error('Cierra las otras pestañas de Taquilla para actualizar el almacén local'));
  }).catch((err: unknown) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const request = fn(tx.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request error'));
      }),
  );
}

export function idbPut<T>(store: string, value: T): Promise<void> {
  return run<IDBValidKey>(store, 'readwrite', (s) => s.put(value)).then(() => undefined);
}

export function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return run<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
}

export function idbGetAll<T>(store: string, limit?: number): Promise<T[]> {
  return run<T[]>(store, 'readonly', (s) => s.getAll(undefined, limit) as IDBRequest<T[]>);
}

export function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  return run<undefined>(store, 'readwrite', (s) => s.delete(key)).then(() => undefined);
}

export function idbCount(store: string): Promise<number> {
  return run<number>(store, 'readonly', (s) => s.count());
}

export function idbClear(store: string): Promise<void> {
  return run<undefined>(store, 'readwrite', (s) => s.clear()).then(() => undefined);
}

/** Escritura en bloque en UNA transacción: 45.000 entradas de manifiesto una a
 *  una son 45.000 transacciones y tres minutos de reloj en una tablet. */
export function idbBulkPut<T>(store: string, values: T[]): Promise<void> {
  if (!values.length) return Promise.resolve();
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        for (const value of values) os.put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB bulk error'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB bulk abort'));
      }),
  );
}

/** Borra en bloque las claves indicadas (usado al confirmar un lote de sync). */
export function idbBulkDelete(store: string, keys: IDBValidKey[]): Promise<void> {
  if (!keys.length) return Promise.resolve();
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        for (const key of keys) os.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB bulk delete error'));
      }),
  );
}
