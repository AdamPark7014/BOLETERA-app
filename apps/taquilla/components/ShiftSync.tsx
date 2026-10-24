'use client';

import { useCallback, useEffect } from 'react';
import { flushQueue } from '@/lib/offline-queue';
import { syncScans } from '@/lib/scan-queue';
import { clearFailedSync, syncOfflineSales, type OfflinePosPayload } from '@/lib/pos';

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
    });
    void syncScans().catch(() => undefined);
  }, []);

  useEffect(() => {
    syncAll();
    window.addEventListener('online', syncAll);
    return () => window.removeEventListener('online', syncAll);
  }, [syncAll]);

  return null;
}
