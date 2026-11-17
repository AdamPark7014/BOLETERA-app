'use client';

import { useCallback, useEffect } from 'react';
import { flushQueue } from '@/lib/offline-queue';
import { syncScans, listConflicts } from '@/lib/scan-queue';
import {
  clearFailedSync,
  getFailedSync,
  syncOfflineSales,
  type OfflinePosPayload,
} from '@/lib/pos';

/** La cola local se vacía en cualquier pantalla del turno, no solo en el inicio. */
export function ShiftSync() {
  const syncAll = useCallback(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    void flushQueue(async (payload) => {
      if ((payload as OfflinePosPayload).type === 'pos') {
        await syncOfflineSales([payload as OfflinePosPayload]);
      }
    }).then((n) => {
      if (n > 0) clearFailedSync();
      const failed = getFailedSync();
      if (failed.length) {
        window.dispatchEvent(
          new CustomEvent('bt-sync-conflict', {
            detail: {
              message: `${failed.length} venta(s) no se pudieron subir. Revisa el aviso de conflictos.`,
            },
          })
        );
      }
    });
    void syncScans()
      .then(async () => {
        const conflicts = await listConflicts().catch(() => []);
        if (conflicts.length) {
          window.dispatchEvent(
            new CustomEvent('bt-sync-conflict', {
              detail: {
                message: `${conflicts.length} escaneo(s) en conflicto al sincronizar.`,
              },
            })
          );
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    syncAll();
    window.addEventListener('online', syncAll);
    return () => window.removeEventListener('online', syncAll);
  }, [syncAll]);

  return null;
}
