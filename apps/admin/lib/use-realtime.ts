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
  /**
   * Prepara la URL justo antes de cada conexión (p. ej. pide un ticket de SSE
   * de vida corta). Si devuelve null, no se conecta en ese intento.
   */
  prepareUrl?: (url: string) => Promise<string | null>;
};

export function useRealtime<T>({
  url,
  queryKey,
  eventName,
  enabled = true,
  parse = (payload) => JSON.parse(payload) as T,
  merge = (_current, incoming) => incoming,
  maxRetries = Number.POSITIVE_INFINITY,
  prepareUrl,
}: RealtimeOptions<T>) {
  const client = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const keyRef = useRef(queryKey);
  const parseRef = useRef(parse);
  const mergeRef = useRef(merge);
  const prepareRef = useRef(prepareUrl);
  prepareRef.current = prepareUrl;
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

    const scheduleRetry = () => {
      attempts += 1;
      if (attempts > maxRetries) {
        setStatus('error');
        setError(new Error('Se agotaron los intentos de reconexión en tiempo real.'));
        return;
      }
      setStatus('reconnecting');
      const delay = Math.min(1_000 * 2 ** (attempts - 1), 30_000);
      retryTimer = setTimeout(() => void connect(), delay);
    };

    const connect = async () => {
      if (disposed) return;
      setStatus(attempts === 0 ? 'connecting' : 'reconnecting');
      let target: string | null = url;
      if (prepareRef.current) {
        try {
          target = await prepareRef.current(url);
        } catch {
          target = null;
        }
      }
      if (disposed) return;
      if (!target) {
        scheduleRetry();
        return;
      }
      source = new EventSource(target);

      source.onopen = () => {
        attempts = 0;
        setError(null);
        setStatus('connected');
      };

      const onMessage = (event: MessageEvent<string>) => {
        try {
          const incoming = parseRef.current(event.data);
          client.setQueryData<T>(keyRef.current, (current) => mergeRef.current(current, incoming));
        } catch (cause) {
          const parseError = cause instanceof Error ? cause : new Error('Evento SSE inválido');
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
        scheduleRetry();
      };
    };

    void connect();
    return () => {
      disposed = true;
      source?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [client, enabled, eventName, maxRetries, url]);

  return { status, error };
}

/**
 * El stream de reportes no acepta el JWT por query: hay que pedir antes un
 * ticket de vida corta (`POST /auth/stream-ticket`) y pasarlo como `?ticket=`.
 * Se pide uno nuevo en cada conexión porque caduca en minutos.
 */
async function withStreamTicket(base: string, url: string, token: string | null) {
  if (!token) return null;
  const response = await fetch(`${base}/auth/stream-ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { ticket?: string; data?: { ticket?: string } };
  const ticket = body.ticket ?? body.data?.ticket;
  if (!ticket) return null;
  const join = url.includes('?') ? '&' : '?';
  return `${url}${join}ticket=${encodeURIComponent(ticket)}`;
}

export function useRealtimeDashboardUpdates(eventId?: string) {
  const { organizationId, token } = useSession();
  const base =
    process.env.NEXT_PUBLIC_ADMIN_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://127.0.0.1:4000/api/v1';
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : '';
  const url = organizationId
    ? `${base}/reports/dashboard/realtime/${organizationId}/stream${query}`
    : null;
  return useRealtime<RealtimeDashboard>({
    url,
    queryKey: queryKeys.analytics.realtime(organizationId ?? '', eventId),
    enabled: Boolean(organizationId),
    prepareUrl: (target) => withStreamTicket(base, target, tokenRef.current),
  });
}
