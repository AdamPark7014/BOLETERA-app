'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { http, HttpError } from '@/lib/http';
import {
  createId,
  LOG_LIMIT,
  readLog,
  readQueue,
  readSoundEnabled,
  readStation,
  scanBody,
  writeLog,
  writeQueue,
  writeSoundEnabled,
  writeStation,
} from './scan-store';
import type {
  QueuedScan,
  ScanApiResponse,
  ScanRecord,
  ScanSource,
  ScanStats,
  ScanVerdict,
} from './types';

export type Connectivity = 'online' | 'offline' | 'degraded';

export type ScanFeedback = {
  id: string;
  verdict: ScanVerdict;
  title: string;
  detail: string;
  at: string;
};

type UseScanStationResult = {
  station: string;
  setStation: (value: string) => void;
  soundEnabled: boolean;
  setSoundEnabled: (value: boolean) => void;
  online: boolean;
  connectivity: Connectivity;
  queueing: boolean;
  lastResult: ScanFeedback | null;
  clearFeedback: () => void;
  log: ScanRecord[];
  queue: QueuedScan[];
  stats: ScanStats;
  scan: (raw: string, source?: ScanSource) => Promise<void>;
  flushQueue: () => Promise<void>;
  clearLog: () => void;
};

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

function computeStats(log: readonly ScanRecord[], queuedCount: number): ScanStats {
  const now = Date.now();
  const minuteAgo = now - 60_000;
  const hourAgo = now - 3_600_000;

  let approved = 0;
  let rejected = 0;
  let queued = 0;
  let lastMinute = 0;
  let lastHour = 0;
  const latencies: number[] = [];
  const buckets = new Map<number, number>();

  for (const entry of log) {
    const at = Date.parse(entry.at);
    if (!Number.isFinite(at)) continue;
    if (entry.verdict === 'approved') approved += 1;
    else if (entry.verdict === 'rejected') rejected += 1;
    else queued += 1;
    if (typeof entry.latencyMs === 'number') latencies.push(entry.latencyMs);
    if (at >= minuteAgo) lastMinute += 1;
    if (at >= hourAgo) lastHour += 1;
    const bucket = Math.floor(at / 60_000);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }

  let peak = 0;
  for (const count of buckets.values()) {
    if (count > peak) peak = count;
  }

  const resolved = approved + rejected;
  return {
    total: log.length,
    approved,
    rejected,
    queued: Math.max(queued, queuedCount),
    approvalRate: resolved > 0 ? approved / resolved : null,
    throughputPerMin: lastMinute,
    peakPerMin: peak,
    medianLatencyMs: median(latencies),
    lastHourCount: lastHour,
  };
}

function feedbackFrom(record: ScanRecord): ScanFeedback {
  if (record.verdict === 'approved') {
    const seat = [record.ticket?.section, record.ticket?.row, record.ticket?.seatNumber]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' · ');
    return {
      id: record.id,
      verdict: 'approved',
      title: 'Acceso permitido',
      detail: [record.ticket?.eventTitle, seat || record.ticket?.code || record.raw]
        .filter((part): part is string => Boolean(part))
        .join(' — '),
      at: record.at,
    };
  }
  if (record.verdict === 'queued') {
    return {
      id: record.id,
      verdict: 'queued',
      title: 'En cola offline',
      detail: 'Se validará al recuperar la conexión.',
      at: record.at,
    };
  }
  return {
    id: record.id,
    verdict: 'rejected',
    title: 'Acceso denegado',
    detail: record.reason ?? 'Código no válido',
    at: record.at,
  };
}

function playTone(verdict: ScanVerdict, enabled: boolean): void {
  if (!enabled || typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    if (verdict === 'approved') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1175, now + 0.08);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.24);
    } else if (verdict === 'rejected') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.start(now);
      osc.stop(now + 0.3);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.2);
    }
    window.setTimeout(() => void ctx.close().catch(() => undefined), 400);
  } catch {
    /* audio opcional */
  }
}

function errorMessage(cause: unknown): string {
  if (cause instanceof HttpError) return cause.message;
  if (cause instanceof Error && cause.message) return cause.message;
  return 'Escaneo rechazado';
}

export function useScanStation(): UseScanStationResult {
  const [station, setStationState] = useState('');
  const [soundEnabled, setSoundState] = useState(true);
  const [online, setOnline] = useState(true);
  const [degraded, setDegraded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<ScanRecord[]>([]);
  const [queue, setQueue] = useState<QueuedScan[]>([]);
  const [lastResult, setLastResult] = useState<ScanFeedback | null>(null);

  const stationRef = useRef(station);
  const soundRef = useRef(soundEnabled);
  const busyRef = useRef(false);
  stationRef.current = station;
  soundRef.current = soundEnabled;

  useEffect(() => {
    const existing = readStation();
    const initial = existing || `Puerta-${String(Date.now()).slice(-4)}`;
    setStationState(initial);
    if (!existing) writeStation(initial);
    setSoundState(readSoundEnabled());
    setLog(readLog());
    setQueue(readQueue());
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
  }, []);

  const persistLog = useCallback((next: ScanRecord[]) => {
    const trimmed = next.slice(0, LOG_LIMIT);
    setLog(trimmed);
    writeLog(trimmed);
  }, []);

  const persistQueue = useCallback((next: QueuedScan[]) => {
    setQueue(next);
    writeQueue(next);
  }, []);

  const pushRecord = useCallback(
    (record: ScanRecord) => {
      persistLog([record, ...readLog()].slice(0, LOG_LIMIT));
      setLastResult(feedbackFrom(record));
      playTone(record.verdict, soundRef.current);
    },
    [persistLog],
  );

  const flushQueue = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const items = readQueue();
    if (!items.length) return;

    const remaining: QueuedScan[] = [];
    let hadFailure = false;

    for (const item of items) {
      const started = performance.now();
      try {
        const res = await http<ScanApiResponse>('/access/scan', {
          method: 'POST',
          body: {
            ...scanBody(item.raw),
            scannedBy: item.station || stationRef.current || 'admin-scanner',
            channel: 'ADMIN',
          },
        });
        pushRecord({
          id: createId(),
          raw: item.raw,
          verdict: res.success ? 'approved' : 'rejected',
          at: new Date().toISOString(),
          source: 'queue',
          station: item.station || stationRef.current,
          ticket: res.ticket,
          latencyMs: Math.round(performance.now() - started),
        });
      } catch (cause) {
        hadFailure = true;
        if (cause instanceof HttpError && cause.status !== null && cause.status < 500) {
          pushRecord({
            id: createId(),
            raw: item.raw,
            verdict: 'rejected',
            at: new Date().toISOString(),
            source: 'queue',
            station: item.station || stationRef.current,
            reason: errorMessage(cause),
            latencyMs: Math.round(performance.now() - started),
          });
        } else {
          remaining.push(item);
        }
      }
    }

    persistQueue(remaining);
    setDegraded(hadFailure && remaining.length > 0);
    if (!remaining.length) setDegraded(false);
  }, [persistQueue, pushRecord]);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void flushQueue();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    if (navigator.onLine) void flushQueue();
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flushQueue]);

  const scan = useCallback(
    async (raw: string, source: ScanSource = 'manual') => {
      const value = raw.trim();
      if (!value || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);

      const stationName = stationRef.current.trim() || 'admin-scanner';
      const started = performance.now();

      try {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          const item: QueuedScan = {
            id: createId(),
            raw: value,
            at: new Date().toISOString(),
            station: stationName,
            source,
          };
          persistQueue([...readQueue(), item]);
          pushRecord({
            id: item.id,
            raw: value,
            verdict: 'queued',
            at: item.at,
            source,
            station: stationName,
            ticket: { code: value.slice(0, 48), eventTitle: 'En cola offline' },
          });
          return;
        }

        try {
          const res = await http<ScanApiResponse>('/access/scan', {
            method: 'POST',
            body: {
              ...scanBody(value),
              scannedBy: stationName,
              channel: 'ADMIN',
            },
          });
          setDegraded(false);
          pushRecord({
            id: createId(),
            raw: value,
            verdict: res.success ? 'approved' : 'rejected',
            at: new Date().toISOString(),
            source,
            station: stationName,
            ticket: res.ticket,
            latencyMs: Math.round(performance.now() - started),
            reason: res.success ? undefined : 'Respuesta sin éxito',
          });
        } catch (cause) {
          const networkish =
            cause instanceof HttpError && (cause.status === null || cause.status >= 500);
          if (networkish) {
            setDegraded(true);
            const item: QueuedScan = {
              id: createId(),
              raw: value,
              at: new Date().toISOString(),
              station: stationName,
              source,
            };
            persistQueue([...readQueue(), item]);
            pushRecord({
              id: item.id,
              raw: value,
              verdict: 'queued',
              at: item.at,
              source,
              station: stationName,
              reason: 'Servicio degradado — encolado',
              ticket: { code: value.slice(0, 48), eventTitle: 'En cola (degradado)' },
            });
          } else {
            pushRecord({
              id: createId(),
              raw: value,
              verdict: 'rejected',
              at: new Date().toISOString(),
              source,
              station: stationName,
              reason: errorMessage(cause),
              latencyMs: Math.round(performance.now() - started),
            });
          }
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [persistQueue, pushRecord],
  );

  const setStation = useCallback((value: string) => {
    setStationState(value);
    writeStation(value);
  }, []);

  const setSoundEnabled = useCallback((value: boolean) => {
    setSoundState(value);
    writeSoundEnabled(value);
  }, []);

  const clearLog = useCallback(() => {
    persistLog([]);
    setLastResult(null);
  }, [persistLog]);

  const clearFeedback = useCallback(() => setLastResult(null), []);

  const stats = useMemo(() => computeStats(log, queue.length), [log, queue.length]);

  const connectivity: Connectivity = !online ? 'offline' : degraded ? 'degraded' : 'online';

  return {
    station,
    setStation,
    soundEnabled,
    setSoundEnabled,
    online,
    connectivity,
    queueing: busy,
    lastResult,
    clearFeedback,
    log,
    queue,
    stats,
    scan,
    flushQueue,
    clearLog,
  };
}
