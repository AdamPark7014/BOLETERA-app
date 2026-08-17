'use client';

import { useEffect, useState } from 'react';
import {
  useRealtimeDashboardUpdates,
  type RealtimeStatus,
} from '@/lib/use-realtime';

export type ConnectionTone = 'online' | 'connecting' | 'offline' | 'error';

export type ConnectionState = {
  tone: ConnectionTone;
  label: string;
  detail: string;
  sseStatus: RealtimeStatus;
  online: boolean;
};

function mapState(online: boolean, sse: RealtimeStatus): ConnectionState {
  if (!online) {
    return {
      tone: 'offline',
      label: 'Sin red',
      detail: 'Sin conexión a internet',
      sseStatus: sse,
      online,
    };
  }
  switch (sse) {
    case 'connected':
      return {
        tone: 'online',
        label: 'En línea',
        detail: 'Tiempo real conectado',
        sseStatus: sse,
        online,
      };
    case 'connecting':
      return {
        tone: 'connecting',
        label: 'Conectando',
        detail: 'Estableciendo tiempo real…',
        sseStatus: sse,
        online,
      };
    case 'reconnecting':
      return {
        tone: 'connecting',
        label: 'Reconectando',
        detail: 'Reintentando tiempo real…',
        sseStatus: sse,
        online,
      };
    case 'error':
      return {
        tone: 'error',
        label: 'Tiempo real fallido',
        detail: 'No se pudo mantener la conexión SSE',
        sseStatus: sse,
        online,
      };
    case 'idle':
    default:
      return {
        tone: 'connecting',
        label: 'En espera',
        detail: 'Tiempo real inactivo',
        sseStatus: sse,
        online,
      };
  }
}

/**
 * Isolates SSE + network listeners so the rest of the shell does not
 * re-render on connection ticks.
 */
export function useConnectionStatus(): ConnectionState {
  const { status: sseStatus } = useRealtimeDashboardUpdates();
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return mapState(online, sseStatus);
}
