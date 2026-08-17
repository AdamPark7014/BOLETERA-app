'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { RealtimeDashboard } from './platform-api';
import { queryKeys } from './query-keys';
import { useSession } from './use-session';

export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export type RealtimeOptions<T> = {
  url: string | null;
  queryKey: QueryKey;
  eventName?: string;
  enabled?: boolean;
  parse?: (payload: string) => T;
  merge?: (current: T | undefined, incoming: T) => T;
  maxRetries?: number;
};

export function useRealtime<T>({
  url,
  queryKey,
  eventName,
  enabled = true,
  parse = (payload) => JSON.parse(payload) as T,
  merge = (_current, incoming) => incoming,
  maxRetries = Number.POSITIVE_INFINITY,
}: RealtimeOptions<T>) {
  const client = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const keyRef = useRef(queryKey);
  const parseRef = useRef(parse);
  const mergeRef = useRef(merge);
  keyRef.current = queryKey;
  parseRef.current = parse;
  mergeRef.current = merge;

  useEffect(() => {
    if (!enabled || !url || typeof EventSource === 'undefined') {
      setStatus('idle');
      return;
    }

    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      setStatus(attempts === 0 ? 'connecting' : 'reconnecting');
      source = new EventSource(url);

      source.onopen = () => {
        attempts = 0;
        setError(null);
        setStatus('connected');
      };

      const onMessage = (event: MessageEvent<string>) => {
        try {
          const incoming = parseRef.current(event.data);
          client.setQueryData<T>(keyRef.current, (current) =>
            mergeRef.current(current, incoming),
          );
        } catch (cause) {
          const parseError =
            cause instanceof Error ? cause : new Error('Evento SSE inválido');
          setError(parseError);
          console.error('No se pudo procesar una actualización en tiempo real', parseError);
        }
      };

      if (eventName) source.addEventListener(eventName, onMessage as EventListener);
      else source.onmessage = onMessage;

      source.onerror = () => {
        source?.close();
        source = null;
        if (disposed) return;
        attempts += 1;
        if (attempts > maxRetries) {
          setStatus('error');
          setError(new Error('Se agotaron los intentos de reconexión en tiempo real.'));
          return;
        }
        setStatus('reconnecting');
        const delay = Math.min(1_000 * 2 ** (attempts - 1), 30_000);
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      source?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [client, enabled, eventName, maxRetries, url]);

  return { status, error };
}

export function useRealtimeDashboardUpdates(eventId?: string) {
  const { organizationId } = useSession();
  const base =
    process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://127.0.0.1:4000/api/v1';
  const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : '';
  const url = organizationId
    ? `${base}/reports/dashboard/realtime/${organizationId}/stream${query}`
    : null;
  return useRealtime<RealtimeDashboard>({
    url,
    queryKey: queryKeys.analytics.realtime(organizationId ?? '', eventId),
    enabled: Boolean(organizationId),
  });
}
