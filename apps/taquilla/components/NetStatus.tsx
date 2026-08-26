'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, StatusDot } from '@boletera/ui';
import { TOKEN_WARN_MINUTES, tokenTimeLeftMs } from '@/lib/auth';
import { getQueueSize } from '@/lib/offline-queue';
import { listConflicts, pendingScanCount } from '@/lib/scan-queue';
import styles from './NetStatus.module.scss';

export type OpsStatus = {
  online: boolean;
  pendingSales: number;
  pendingScans: number;
  conflicts: number;
  tokenMinutesLeft: number | null;
  refresh: () => void;
};

/**
 * Estado de red y de operaciones pendientes. Se refresca cada 5 s y ante los
 * eventos online/offline: el operador tiene que saber SIEMPRE si está vendiendo
 * contra el servidor o contra la cola local, y cuánto lleva sin sincronizar.
 */
export function useOpsStatus(): OpsStatus {
  const [online, setOnline] = useState(true);
  const [pendingSales, setPendingSales] = useState(0);
  const [pendingScans, setPendingScans] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [tokenMinutesLeft, setTokenMinutesLeft] = useState<number | null>(null);

  const refresh = useCallback(() => {
    if (typeof navigator !== 'undefined') setOnline(navigator.onLine);
    void getQueueSize().then(setPendingSales);
    void pendingScanCount().then(setPendingScans);
    void listConflicts().then((list) => setConflicts(list.length));
    const left = tokenTimeLeftMs();
    setTokenMinutesLeft(left == null ? null : Math.floor(left / 60000));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
    };
  }, [refresh]);

  return { online, pendingSales, pendingScans, conflicts, tokenMinutesLeft, refresh };
}

export function NetStatus({ status }: { status: OpsStatus }) {
  const pending = status.pendingSales + status.pendingScans;
  const warnToken = status.tokenMinutesLeft != null && status.tokenMinutesLeft <= TOKEN_WARN_MINUTES;

  return (
    <div className={styles.wrap}>
      <span className={styles.statusLine}>
        <StatusDot
          tone={status.online ? 'success' : 'warning'}
          pulse={!status.online}
          label={status.online ? 'En línea' : 'Sin red · cola local'}
        />
      </span>

      {pending > 0 && (
        <Badge
          tone="neutral"
          variant="outline"
          className={styles.chip}
          title="Operaciones sin sincronizar"
        >
          {pending} pendiente{pending === 1 ? '' : 's'}
          {status.pendingScans > 0
            ? ` · ${status.pendingScans} escaneo${status.pendingScans === 1 ? '' : 's'}`
            : ''}
        </Badge>
      )}

      {status.conflicts > 0 && (
        <Badge tone="danger" variant="soft" dot className={styles.chip}>
          {status.conflicts} conflicto{status.conflicts === 1 ? '' : 's'}
        </Badge>
      )}

      {warnToken && status.tokenMinutesLeft != null && (
        <Badge tone="warning" variant="soft" className={styles.chip}>
          Sesión: {status.tokenMinutesLeft} min
        </Badge>
      )}
    </div>
  );
}
