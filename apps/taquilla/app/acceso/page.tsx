'use client';

import { friendlyError } from '@/lib/errors';
import { formatDateTime as uiDateTime, formatTime as uiTime } from '@boletera/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field } from '@boletera/ui';
import { ApiError, apiJson, getTaquillaToken } from '@/lib/auth';
import { PosShell } from '@/components/PosShell';
import type { Hotkey } from '@/lib/hotkeys';
import {
  downloadManifest,
  getLocalScan,
  listManifests,
  lookupManifestEntry,
  parseQrPayload,
  recordLocalScan,
  type ManifestMeta,
} from '@/lib/manifest';
import {
  clearConflicts,
  enqueueScan,
  listConflicts,
  pendingScanCount,
  syncScans,
  type ScanConflict,
} from '@/lib/scan-queue';
import styles from './acceso.module.scss';

type EventRow = { id: string; title: string; startsAt: string; venue?: { name: string } };

type Verdict = 'OK' | 'DUPLICATE' | 'INVALID' | 'UNKNOWN' | 'OFFLINE_OK' | 'OFFLINE_UNVERIFIABLE';

type ScanOutcomeView = {
  verdict: Verdict;
  title: string;
  detail: string;
  extra?: string;
  at: number;
  /** Error del operador (falta función, zona mal escrita): ámbar, no rojo. */
  tone?: 'warn';
  code?: string;
  eventTitle?: string;
  section?: string | null;
  row?: string | null;
  seat?: string | null;
  holderName?: string | null;
  ticketType?: string | null;
};

type LiveStats = {
  admitted: number;
  expected: number;
  remaining: number;
  insideNow?: number;
  exited?: number;
  lastTenMinutes: number;
  byGate: {
    zoneId: string | null;
    name: string;
    admitted: number;
    exited?: number;
    inside?: number;
  }[];
};

type LookupTicket = {
  id: string;
  code: string;
  buyerName: string | null;
  buyerEmail: string | null;
  section: string | null;
  row: string | null;
  seatNumber: string | null;
  status: string;
  holderName: string | null;
  ticketType: string | null;
};

const ZONE_KEY = 'taquilla_access_zone';
const MODE_KEY = 'taquilla_access_mode';

function toneOf(o: ScanOutcomeView): 'ok' | 'bad' | 'warn' {
  if (o.verdict === 'OK' || o.verdict === 'OFFLINE_OK') return 'ok';
  if (o.verdict === 'OFFLINE_UNVERIFIABLE' || o.tone === 'warn') return 'warn';
  return 'bad';
}

function clock(ms: number) {
  return uiTime(new Date(ms));
}

function seatShort(o: ScanOutcomeView) {
  return [o.section, o.row ? `Fila ${o.row}` : null, o.seat].filter(Boolean).join(' · ');
}

function agoLabel(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'hace menos de un minuto';
  if (mins < 120) return `hace ${mins} min`;
  return `el ${uiDateTime(new Date(iso))}`;
}

export default function AccesoPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventId, setEventId] = useState('');
  /** Totales de toda la función (todas las puertas), no solo de este equipo. */
  const [live, setLive] = useState<LiveStats | null>(null);
  const [zoneId, setZoneId] = useState('');
  const [manifests, setManifests] = useState<ManifestMeta[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<ScanOutcomeView | null>(null);
  const [history, setHistory] = useState<ScanOutcomeView[]>([]);
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState<ScanConflict[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [stamps, setStamps] = useState<Array<{ at: number; ok: boolean }>>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(true);
  const [scanMode, setScanMode] = useState<'ENTRY' | 'EXIT'>('ENTRY');
  const [lookupQ, setLookupQ] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupHits, setLookupHits] = useState<LookupTicket[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');

  useEffect(() => {
    const sync = () => {
      setNow(Date.now());
      setOnline(navigator.onLine);
    };
    sync();
    const id = setInterval(sync, 10000);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 4000);
  }, []);

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
  }, [router]);

  useEffect(() => {
    setZoneId(localStorage.getItem(ZONE_KEY) || '');
    const savedMode = localStorage.getItem(MODE_KEY);
    if (savedMode === 'EXIT' || savedMode === 'ENTRY') setScanMode(savedMode);
    apiJson<EventRow[]>('/taquilla/events')
      .then((data) => {
        const sorted = [...data].sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
        setEvents(sorted);
        setEventId((cur) => cur || sorted[0]?.id || '');
      })
      .catch(() => setEvents([]));
  }, []);

  const refreshLocal = useCallback(() => {
    void listManifests().then(setManifests);
    void pendingScanCount().then(setPending);
    void listConflicts().then(setConflicts);
  }, []);

  useEffect(() => {
    refreshLocal();
    const id = setInterval(refreshLocal, 8000);
    return () => clearInterval(id);
  }, [refreshLocal]);

  const manifest = useMemo(
    () => manifests.find((m) => m.eventId === eventId) ?? null,
    [manifests, eventId]
  );

  const pushOutcome = useCallback((next: ScanOutcomeView) => {
    setOutcome(next);
    setDetailsOpen(false);
    setHistory((prev) => [next, ...prev].slice(0, 8));
    // Contadores de esta sesión de puerta: el API no expone el total por puerta.
    setStamps((prev) => [...prev, { at: next.at, ok: toneOf(next) === 'ok' }].slice(-2000));
  }, []);

  // -------------------------------------------------------------------------

  const runSync = useCallback(async () => {
    if (!navigator.onLine) {
      showToast('Sin red: los escaneos siguen en cola');
      return;
    }
    try {
      const result = await syncScans(zoneId || undefined);
      refreshLocal();
      if (result.sent === 0) {
        showToast('No hay escaneos pendientes');
        return;
      }
      showToast(
        `${result.applied} aplicados · ${result.conflicts} conflictos · ${result.rejected} rechazados`
      );
    } catch (err) {
      showToast(friendlyError(err, 'No se pudo sincronizar'));
    }
  }, [zoneId, refreshLocal, showToast]);

  // Al volver la red se envía solo: nadie en la puerta va a acordarse de pulsar F8.
  useEffect(() => {
    const onOnline = () => void runSync();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [runSync]);

  const doDownload = useCallback(async () => {
    if (!eventId) return;
    setDownloading(0);
    try {
      const meta = await downloadManifest(eventId, {
        eventTitle: events.find((e) => e.id === eventId)?.title,
        onProgress: setDownloading,
      });
      refreshLocal();
      showToast(`Lista descargada: ${meta.count} boletos`);
    } catch (err) {
      showToast(friendlyError(err, 'No se pudo descargar la lista de boletos'));
    } finally {
      setDownloading(null);
    }
  }, [eventId, events, refreshLocal, showToast]);

  const scanOffline = useCallback(
    async (raw: string) => {
      const qr = parseQrPayload(raw);
      if (!qr) {
        // Honestidad: el manifiesto lleva ids de boleto, no códigos impresos.
        pushOutcome({
          verdict: 'OFFLINE_UNVERIFIABLE',
          title: 'SIN VERIFICAR',
          detail:
            'Sin red sólo se puede validar el QR. Un código escrito a mano no está en la lista descargada.',
          at: Date.now(),
        });
        return;
      }

      if (eventId && qr.eventId && qr.eventId !== eventId) {
        pushOutcome({
          verdict: 'INVALID',
          title: 'OTRA FUNCIÓN',
          detail: 'Este QR es de otra función.',
          extra: 'No se registró la entrada.',
          at: Date.now(),
        });
        return;
      }

      const previous = await getLocalScan(qr.ticketId);
      if (previous) {
        pushOutcome({
          verdict: 'DUPLICATE',
          title: 'YA ENTRÓ',
          detail: `Este boleto pasó por esta puerta ${agoLabel(previous.scannedAt)}.`,
          extra: 'Repetido detectado en este equipo. Llama a supervisión.',
          at: Date.now(),
        });
        return;
      }

      const entry = await lookupManifestEntry(qr.ticketId);
      const scannedAt = new Date().toISOString();

      if (!entry) {
        pushOutcome({
          verdict: 'UNKNOWN',
          title: 'NO VÁLIDO',
          detail: 'El boleto no está en la lista descargada de esta función.',
          extra: 'Puede ser falso o la lista estar incompleta.',
          at: Date.now(),
        });
        await recordLocalScan({
          ticketId: qr.ticketId,
          eventId: qr.eventId,
          scannedAt,
          zoneId: zoneId || undefined,
          outcome: 'unknown',
        });
        return;
      }

      if (scanMode === 'EXIT') {
        if (entry.st !== 'U') {
          pushOutcome({
            verdict: 'INVALID',
            title: 'NO ESTÁ DENTRO',
            detail: 'Sin red solo se puede registrar salida de boletos ya usados en la lista.',
            at: Date.now(),
          });
          return;
        }
        pushOutcome({
          verdict: 'OFFLINE_OK',
          title: 'SALIDA',
          detail: 'Salida registrada sin red; se subirá al volver la conexión.',
          at: Date.now(),
        });
        await recordLocalScan({
          ticketId: qr.ticketId,
          eventId: qr.eventId,
          scannedAt,
          zoneId: zoneId || undefined,
          outcome: 'ok',
        });
        await enqueueScan({
          ticketId: qr.ticketId,
          eventId: qr.eventId,
          scannedAt,
          zoneId: zoneId || undefined,
          mode: 'EXIT',
        });
        refreshLocal();
        return;
      }

      if (entry.st === 'U') {
        pushOutcome({
          verdict: 'DUPLICATE',
          title: 'YA ENTRÓ',
          detail: 'La lista descargada ya lo tenía como usado.',
          extra: 'Se registra igual y saldrá en conflictos al sincronizar.',
          at: Date.now(),
        });
      } else {
        pushOutcome({
          verdict: 'OFFLINE_OK',
          title: 'ADELANTE',
          detail: 'Validado sin red con la lista descargada.',
          extra: 'No se verificó la firma del QR ni cancelaciones posteriores.',
          at: Date.now(),
        });
      }

      await recordLocalScan({
        ticketId: qr.ticketId,
        eventId: qr.eventId,
        scannedAt,
        zoneId: zoneId || undefined,
        outcome: entry.st === 'U' ? 'duplicate' : 'ok',
      });
      await enqueueScan({
        ticketId: qr.ticketId,
        eventId: qr.eventId,
        scannedAt,
        zoneId: zoneId || undefined,
        mode: 'ENTRY',
      });
      refreshLocal();
    },
    [pushOutcome, zoneId, eventId, refreshLocal, scanMode]
  );

  const scan = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value || busy) return;
      if (!eventId) {
        // Sin función elegida la puerta no puede saber si el boleto es de esta
        // noche: el API lo aceptaría aunque fuera de otro evento.
        pushOutcome({
          verdict: 'INVALID',
          title: 'ELIGE LA FUNCIÓN',
          detail: 'Elige la función de esta puerta antes de escanear.',
          tone: 'warn',
          at: Date.now(),
        });
        return;
      }
      setBusy(true);
      setCode('');
      try {
        if (!navigator.onLine) {
          await scanOffline(value);
          return;
        }

        const qr = parseQrPayload(value);
        const body = qr ? { qrPayload: value } : { ticketCode: value };
        try {
          // `scannedBy` YA NO se manda: el API lo saca del JWT (era falsificable).
          const data = await apiJson<{
            action?: string;
            ticket?: {
              code?: string;
              section?: string | null;
              row?: string | null;
              seatNumber?: string | null;
              eventTitle?: string;
              holderName?: string | null;
              ticketType?: string | null;
            };
          }>('/access/scan', {
            method: 'POST',
            body: JSON.stringify({
              ...body,
              zoneId: zoneId || undefined,
              eventId,
              mode: scanMode,
            }),
          });
          const t = data.ticket;
          const action = data.action ?? 'ENTRY';
          pushOutcome({
            verdict: 'OK',
            title: action === 'EXIT' ? 'SALIDA' : action === 'REENTRY' ? 'REINGRESO' : 'ADELANTE',
            detail:
              action === 'EXIT'
                ? t?.eventTitle || 'Salida registrada'
                : action === 'REENTRY'
                  ? t?.eventTitle || 'Reingreso permitido'
                  : t?.eventTitle || 'Acceso registrado',
            extra: t?.code,
            code: t?.code,
            eventTitle: t?.eventTitle,
            section: t?.section,
            row: t?.row,
            seat: t?.seatNumber,
            holderName: t?.holderName,
            ticketType: t?.ticketType,
            at: Date.now(),
          });
        } catch (err) {
          if (!(err instanceof ApiError)) {
            // Caída de red a mitad del escaneo: se degrada a manifiesto local.
            await scanOffline(value);
            return;
          }
          const payload = (err.body ?? {}) as {
            code?: string;
            firstScanAt?: string;
            firstScanZoneId?: string;
            firstScanBy?: string;
            message?: string;
            ticketEventTitle?: string;
            ticketCode?: string;
            correctGateLabel?: string;
          };
          if (err.status === 400 && payload.code === 'WRONG_GATE') {
            pushOutcome({
              verdict: 'INVALID',
              title: 'PUERTA INCORRECTA',
              detail:
                payload.message ||
                `Este boleto entra por la puerta ${payload.correctGateLabel ?? 'correcta'}`,
              extra: 'Indica al portador la puerta correcta. El boleto no se marcó.',
              code: payload.ticketCode,
              at: Date.now(),
            });
            return;
          }
          if (err.status === 400 && payload.code === 'NOT_INSIDE') {
            pushOutcome({
              verdict: 'INVALID',
              title: 'NO ESTÁ DENTRO',
              detail: payload.message || 'Este boleto no está dentro del recinto.',
              code: payload.ticketCode,
              at: Date.now(),
            });
            return;
          }
          if (err.status === 400 && payload.code === 'WRONG_EVENT') {
            pushOutcome({
              verdict: 'INVALID',
              title: 'OTRA FUNCIÓN',
              detail: payload.ticketEventTitle
                ? `Este boleto es de «${payload.ticketEventTitle}».`
                : 'Este boleto es de otra función.',
              extra: 'No se marcó como usado. Indica al portador su puerta o fecha.',
              code: payload.ticketCode,
              eventTitle: payload.ticketEventTitle,
              at: Date.now(),
            });
            return;
          }
          if (err.status === 409 && payload.code === 'TICKET_ALREADY_SCANNED') {
            // 409 ≠ 400: "ya escaneado" se resuelve llamando a supervisión;
            // "no válido" se resuelve rechazando al portador.
            pushOutcome({
              verdict: 'DUPLICATE',
              title: 'YA ENTRÓ',
              detail: payload.firstScanAt
                ? `Este boleto se usó ${agoLabel(payload.firstScanAt)}${
                    payload.firstScanZoneId ? ` en la puerta ${payload.firstScanZoneId}` : ''
                  } (${uiTime(new Date(payload.firstScanAt))}).`
                : 'Este boleto ya entró.',
              extra: 'Posible reventa o reingreso. Habla con la persona o llama a supervisión.',
              code: payload.ticketCode,
              at: Date.now(),
            });
            return;
          }
          if (err.status === 404) {
            pushOutcome({
              verdict: 'UNKNOWN',
              title: 'NO VÁLIDO',
              detail: 'Ese código no existe en el sistema.',
              extra: 'Posible boleto falso o mal escrito.',
              at: Date.now(),
            });
            return;
          }
          if (/Unknown access zone/i.test(payload.message || err.message)) {
            // No es culpa del boleto: la zona escrita en esta puerta no existe.
            pushOutcome({
              verdict: 'INVALID',
              title: 'REVISA LA ZONA',
              detail: 'La zona de acceso escrita no existe. Corrígela o déjala vacía.',
              extra: 'El boleto no se marcó como usado.',
              tone: 'warn',
              at: Date.now(),
            });
            return;
          }
          pushOutcome({
            verdict: 'INVALID',
            title: 'NO VÁLIDO',
            detail: friendlyError(err, 'No se pudo validar el boleto.'),
            extra: 'Cancelado, reembolsado, transferido o QR alterado.',
            at: Date.now(),
          });
        }
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, zoneId, eventId, scanOffline, pushOutcome, scanMode]
  );

  const runLookup = useCallback(async () => {
    const q = lookupQ.trim();
    if (!eventId || q.length < 2 || lookupBusy) return;
    setLookupBusy(true);
    setLookupError(null);
    setLookupHits([]);
    setConfirmId(null);
    try {
      if (!navigator.onLine) {
        setLookupError('La búsqueda manual necesita red.');
        return;
      }
      const data = await apiJson<{ tickets: LookupTicket[] }>(
        `/access/events/${encodeURIComponent(eventId)}/lookup?q=${encodeURIComponent(q)}`
      );
      setLookupHits(data.tickets ?? []);
      if (!(data.tickets ?? []).length) setLookupError('Sin resultados.');
    } catch (err) {
      setLookupError(friendlyError(err, 'No se pudo buscar'));
    } finally {
      setLookupBusy(false);
    }
  }, [lookupQ, eventId, lookupBusy]);

  const admitManual = useCallback(
    async (ticket: LookupTicket) => {
      if (!eventId || !confirmName.trim()) return;
      setLookupBusy(true);
      try {
        const data = await apiJson<{
          action?: string;
          ticket?: {
            code?: string;
            section?: string | null;
            row?: string | null;
            seatNumber?: string | null;
            eventTitle?: string;
            holderName?: string | null;
            ticketType?: string | null;
          };
        }>(`/access/events/${encodeURIComponent(eventId)}/manual-admit`, {
          method: 'POST',
          body: JSON.stringify({
            ticketId: ticket.id,
            confirmedName: confirmName.trim(),
            zoneId: zoneId || undefined,
            mode: scanMode,
          }),
        });
        const t = data.ticket;
        const action = data.action ?? 'ENTRY';
        pushOutcome({
          verdict: 'OK',
          title: action === 'EXIT' ? 'SALIDA' : action === 'REENTRY' ? 'REINGRESO' : 'ADELANTE',
          detail: t?.eventTitle || 'Registrado a mano',
          code: t?.code ?? ticket.code,
          eventTitle: t?.eventTitle,
          section: t?.section ?? ticket.section,
          row: t?.row ?? ticket.row,
          seat: t?.seatNumber ?? ticket.seatNumber,
          holderName: t?.holderName ?? ticket.holderName,
          ticketType: t?.ticketType ?? ticket.ticketType,
          at: Date.now(),
        });
        setConfirmId(null);
        setConfirmName('');
        setLookupHits([]);
        setLookupQ('');
      } catch (err) {
        if (err instanceof ApiError) {
          const payload = (err.body ?? {}) as { code?: string; message?: string };
          pushOutcome({
            verdict: 'INVALID',
            title: payload.code === 'CONFIRMED_NAME_MISMATCH' ? 'NO COINCIDE' : 'NO VÁLIDO',
            detail: friendlyError(err, 'No se pudo registrar a mano.'),
            at: Date.now(),
          });
        } else {
          showToast(friendlyError(err, 'No se pudo registrar a mano'));
        }
      } finally {
        setLookupBusy(false);
      }
    },
    [eventId, confirmName, zoneId, scanMode, pushOutcome, showToast]
  );

  const hotkeys = useMemo<Hotkey[]>(
    () => [
      { keys: 'Enter', label: 'Escanear', displayOnly: true },
      {
        keys: 'F5',
        label: 'Descargar lista',
        whileTyping: true,
        run: () => void doDownload(),
      },
      { keys: 'F8', label: 'Subir escaneos', whileTyping: true, run: () => void runSync() },
      {
        keys: 'Esc',
        label: 'Salir',
        whileTyping: true,
        match: (e) => e.key === 'Escape',
        run: () => router.push('/'),
      },
    ],
    [doDownload, runSync, router]
  );

  const currentEvent = events.find((event) => event.id === eventId) ?? null;
  const okCount = stamps.filter((s) => s.ok).length;
  const rejectCount = stamps.length - okCount;
  const perMinute = stamps.filter((s) => s.ok && now - s.at <= 60_000).length;
  const tone = outcome ? toneOf(outcome) : null;
  useEffect(() => {
    setLive(null);
    if (!eventId) return;
    let cancelled = false;
    const pull = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      apiJson<LiveStats>(`/access/events/${encodeURIComponent(eventId)}/live`)
        .then((data) => {
          if (!cancelled) setLive(data);
        })
        .catch(() => {});
    };
    pull();
    const timer = setInterval(pull, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [eventId]);

  const hasTicketData = Boolean(outcome && (outcome.code || outcome.section || outcome.eventTitle));
  const nextScan = () => {
    setOutcome(null);
    setDetailsOpen(false);
    setCode('');
    inputRef.current?.focus();
  };

  return (
    <PosShell
      title="Puerta"
      backHref="/"
      hotkeys={hotkeys}
      escapeGoesBack={false}
      fill
      door
      whoMain={`${scanMode === 'EXIT' ? 'Salida' : 'Entrada'} · ${zoneId.trim() ? `Puerta ${zoneId.trim()}` : 'Puerta'} · ${currentEvent?.title ?? 'Sin función'}`}
      whoSub={
        manifest
          ? `Lista descargada · ${String(manifest.count)} boletos${manifest.complete ? '' : ' (incompleta)'}`
          : ''
      }
      headerExtra={
        !manifest && eventId ? (
          <button
            type="button"
            className={styles.downloadChip}
            disabled={downloading != null}
            onClick={() => void doDownload()}
            aria-label="Descargar lista"
          >
            {downloading != null ? 'Descargando…' : 'Lista sin descargar'}
          </button>
        ) : null
      }
    >
      <div className={styles.door}>
        <div className={styles.stage}>
          {toast ? (
            <p className={styles.toast} role="status">
              {toast}
            </p>
          ) : null}

          <div className={styles.modeRow} role="group" aria-label="Modo de escaneo">
            <button
              type="button"
              className={scanMode === 'ENTRY' ? styles.modeActive : styles.modeBtn}
              aria-pressed={scanMode === 'ENTRY'}
              onClick={() => {
                setScanMode('ENTRY');
                localStorage.setItem(MODE_KEY, 'ENTRY');
              }}
            >
              Entrada
            </button>
            <button
              type="button"
              className={scanMode === 'EXIT' ? styles.modeActive : styles.modeBtn}
              aria-pressed={scanMode === 'EXIT'}
              onClick={() => {
                setScanMode('EXIT');
                localStorage.setItem(MODE_KEY, 'EXIT');
              }}
            >
              Salida
            </button>
          </div>

          <form
            className={styles.scanRow}
            onSubmit={(event) => {
              event.preventDefault();
              void scan(code);
            }}
          >
            <label className={styles.scanField}>
              <span>{scanMode === 'EXIT' ? 'Código para salida' : 'Código del boleto'}</span>
              <input
                ref={inputRef}
                autoFocus
                id="access-scan"
                aria-label="Código"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Código del boleto"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button type="submit" className={styles.validate} disabled={busy || !code.trim()}>
              {busy ? 'Validando…' : scanMode === 'EXIT' ? 'Registrar salida' : 'Validar'}
            </button>
          </form>

          <div
            className={
              tone === 'ok'
                ? styles.resultOk
                : tone === 'bad'
                  ? styles.resultBad
                  : tone === 'warn'
                    ? styles.resultWarn
                    : styles.resultIdle
            }
            role="status"
            aria-live="assertive"
            aria-atomic="true"
          >
            {outcome ? (
              <>
                {tone === 'ok' ? (
                  <svg aria-hidden="true" className={styles.icon} viewBox="0 0 24 24">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : tone === 'bad' ? (
                  <svg aria-hidden="true" className={styles.icon} viewBox="0 0 24 24">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                ) : (
                  <svg aria-hidden="true" className={styles.icon} viewBox="0 0 24 24">
                    <path d="M12 7v6M12 17h.01" />
                  </svg>
                )}
                <p className={styles.verdict}>{outcome.title}</p>
                {tone === 'ok' ? (
                  <>
                    {outcome.holderName ? (
                      <p className={styles.holderName}>{outcome.holderName}</p>
                    ) : null}
                    <p className={styles.holder}>
                      {[outcome.ticketType, outcome.eventTitle || outcome.detail]
                        .filter(Boolean)
                        .join(' · ')}
                      {outcome.verdict === 'OFFLINE_OK' ? ' · validado sin red' : ''}
                    </p>
                    {outcome.section || outcome.row || outcome.seat ? (
                      <div className={styles.seatRow}>
                        {outcome.section ? (
                          <span className={styles.seatChip}>
                            <small>Sección</small>
                            <strong>{outcome.section}</strong>
                          </span>
                        ) : null}
                        {outcome.row ? (
                          <span className={styles.seatChip}>
                            <small>Fila</small>
                            <strong>{outcome.row}</strong>
                          </span>
                        ) : null}
                        {outcome.seat ? (
                          <span className={styles.seatChip}>
                            <small>Asiento</small>
                            <strong>{outcome.seat}</strong>
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className={styles.seatChip}>
                        <small>Acceso</small>
                        <strong>General</strong>
                      </span>
                    )}
                    {outcome.code ? <code className={styles.code}>{outcome.code}</code> : null}
                  </>
                ) : (
                  <>
                    <p className={styles.reason}>{outcome.detail}</p>
                    {outcome.extra ? <p className={styles.reasonSub}>{outcome.extra}</p> : null}
                    {tone === 'bad' && hasTicketData ? (
                      <div className={styles.resultActions}>
                        <button
                          type="button"
                          className={styles.ghostBtn}
                          aria-expanded={detailsOpen}
                          onClick={() => setDetailsOpen((v) => !v)}
                        >
                          Ver boleto
                        </button>
                      </div>
                    ) : null}
                    {detailsOpen && hasTicketData ? (
                      <dl className={styles.ticketData}>
                        {outcome.code ? (
                          <>
                            <dt>Código</dt>
                            <dd>{outcome.code}</dd>
                          </>
                        ) : null}
                        {outcome.eventTitle ? (
                          <>
                            <dt>Función</dt>
                            <dd>{outcome.eventTitle}</dd>
                          </>
                        ) : null}
                        {seatShort(outcome) ? (
                          <>
                            <dt>Lugar</dt>
                            <dd>{seatShort(outcome)}</dd>
                          </>
                        ) : null}
                      </dl>
                    ) : null}
                  </>
                )}
              </>
            ) : (
              <>
                <svg aria-hidden="true" className={styles.iconIdle} viewBox="0 0 24 24">
                  <path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M7 12h10" />
                </svg>
                <p className={styles.idleTitle}>
                  {eventId ? 'Listo para escanear' : 'Elige la función de esta puerta'}
                </p>
                {eventId ? null : (
                  <p className={styles.idleText}>Ábrela en «Ajustes de la puerta».</p>
                )}
              </>
            )}
          </div>

          {outcome ? (
            <button type="button" className={styles.nextBtn} onClick={nextScan}>
              Escanear siguiente
            </button>
          ) : null}
        </div>

        <aside className={styles.side}>
          {live ? (
            <section className={styles.live} aria-label="Toda la función">
              <div className={styles.liveHead}>
                <h2 className={styles.label}>Toda la función</h2>
                <span className={styles.liveCount}>
                  {(live.insideNow ?? live.admitted).toLocaleString('es-MX')} dentro
                </span>
              </div>
              <div
                className={styles.liveBar}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={live.expected || 1}
                aria-valuenow={live.insideNow ?? live.admitted}
                aria-label="Personas dentro del recinto"
              >
                <span
                  style={{
                    width: `${
                      live.expected
                        ? Math.min(100, ((live.insideNow ?? live.admitted) / live.expected) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
              <p className={styles.quiet}>
                Entraron {live.admitted.toLocaleString('es-MX')} · salieron{' '}
                {(live.exited ?? 0).toLocaleString('es-MX')} · faltan{' '}
                {live.remaining.toLocaleString('es-MX')} · {live.lastTenMinutes} en 10 min
              </p>
              {live.byGate.length > 0 ? (
                <ul className={styles.gates}>
                  {live.byGate.map((g) => (
                    <li key={g.zoneId ?? 'none'}>
                      <span>{g.name}</span>
                      <strong>
                        {(g.inside ?? g.admitted).toLocaleString('es-MX')}
                        {typeof g.exited === 'number' ? ` · −${g.exited}` : ''}
                      </strong>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <details className={styles.settings}>
            <summary>Buscar sin teléfono</summary>
            <div className={styles.settingsBody}>
              <p className={styles.quiet}>
                Nombre, correo o folio. Confirma el nombre antes de dejar pasar.
              </p>
              <form
                className={styles.lookupRow}
                onSubmit={(e) => {
                  e.preventDefault();
                  void runLookup();
                }}
              >
                <Field
                  id="access-lookup"
                  label="Buscar"
                  value={lookupQ}
                  onChange={(e) => setLookupQ(e.target.value)}
                  placeholder="Nombre, correo o folio"
                  autoComplete="off"
                />
                <button
                  type="submit"
                  className={styles.pill}
                  disabled={lookupBusy || lookupQ.trim().length < 2 || !eventId}
                >
                  {lookupBusy ? 'Buscando…' : 'Buscar'}
                </button>
              </form>
              {lookupError ? <p className={styles.quiet}>{lookupError}</p> : null}
              {lookupHits.length > 0 ? (
                <ul className={styles.lookupList}>
                  {lookupHits.map((t) => (
                    <li key={t.id}>
                      <div>
                        <strong>{t.holderName || t.buyerName || 'Sin nombre'}</strong>
                        <span>
                          {t.code}
                          {t.ticketType ? ` · ${t.ticketType}` : ''}
                          {t.section ? ` · ${t.section}` : ''}
                        </span>
                      </div>
                      {confirmId === t.id ? (
                        <div className={styles.confirmBox}>
                          <Field
                            id={`confirm-${t.id}`}
                            label="Escribe el nombre del titular"
                            value={confirmName}
                            onChange={(e) => setConfirmName(e.target.value)}
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            className={styles.validate}
                            disabled={lookupBusy || !confirmName.trim()}
                            onClick={() => void admitManual(t)}
                          >
                            Confirmar e {scanMode === 'EXIT' ? 'registrar salida' : 'admitir'}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.pill}
                          onClick={() => {
                            setConfirmId(t.id);
                            setConfirmName(t.buyerName || '');
                          }}
                        >
                          Elegir
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </details>

          <div className={styles.counters}>
            <div className={styles.counter}>
              <span>Entradas</span>
              <strong>{String(okCount)}</strong>
            </div>
            <div className={styles.counter}>
              <span>Por minuto</span>
              <strong>{String(perMinute)}</strong>
            </div>
            <div className={styles.counter}>
              <span>Rechazos</span>
              <strong>{String(rejectCount)}</strong>
            </div>
          </div>

          <div className={pending > 0 ? styles.netWarn : styles.netOk}>
            <span className={styles.dot} aria-hidden="true" />
            <span>
              {online ? 'En línea' : 'Sin red'}
              {pending > 0 ? ` · ${String(pending)} por subir` : ' · todo subido'}
            </span>
            <button type="button" className={styles.linkBtn} onClick={() => void runSync()}>
              Subir ahora
            </button>
          </div>

          <section aria-label="Últimos escaneos">
            <h2 className={styles.label}>Últimos escaneos</h2>
            {history.length === 0 ? (
              <p className={styles.quiet}>Aún no hay escaneos en esta sesión.</p>
            ) : (
              <ul className={styles.recent}>
                {history.slice(0, 6).map((item) => {
                  const t = toneOf(item);
                  return (
                    <li key={item.at}>
                      <span
                        className={
                          t === 'ok' ? styles.dotOk : t === 'bad' ? styles.dotBad : styles.dotWarn
                        }
                        aria-hidden="true"
                      />
                      <span className={styles.recentMain}>
                        {t === 'ok' ? item.code || 'Adelante' : item.title.toLowerCase()}
                      </span>
                      <span className={styles.recentMeta}>{seatShort(item) || '—'}</span>
                      <span className={styles.recentMeta}>{clock(item.at)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <details className={styles.settings} open={!eventId}>
            <summary>Ajustes de la puerta</summary>
            <div className={styles.settingsBody}>
              <div>
                <span className={styles.label}>Función</span>
                <EventPick events={events} eventId={eventId} onChange={setEventId} />
              </div>
              <Field
                id="access-zone"
                label="Zona de acceso"
                value={zoneId}
                onChange={(event) => {
                  setZoneId(event.target.value);
                  localStorage.setItem(ZONE_KEY, event.target.value);
                }}
                placeholder="Zona (opcional)"
                autoComplete="off"
              />
              <div className={styles.manifest}>
                <div>
                  <strong>
                    {manifest
                      ? manifest.complete
                        ? 'Lista completa'
                        : 'Lista incompleta'
                      : 'Sin lista descargada'}
                  </strong>
                  <span>
                    {manifest
                      ? `${String(manifest.count)} boletos · ${uiDateTime(new Date(manifest.issuedAt))}`
                      : 'Descárgala antes de abrir puertas para validar sin red.'}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.pill}
                  aria-label="Descargar lista"
                  disabled={downloading != null || !eventId}
                  onClick={() => void doDownload()}
                >
                  {downloading != null ? `Descargando… ${downloading}` : 'Descargar'} <kbd>F5</kbd>
                </button>
              </div>
            </div>
          </details>

          {conflicts.length > 0 ? (
            <details className={styles.settings} open>
              <summary>
                {conflicts.length} {conflicts.length === 1 ? 'conflicto' : 'conflictos'} al subir
              </summary>
              <div className={styles.settingsBody}>
                <p className={styles.quiet}>El resto del lote sí se aplicó. Estos no.</p>
                <ul className={styles.conflicts}>
                  {conflicts.slice(0, 25).map((conflict) => (
                    <li key={conflict.id}>
                      <code>{conflict.ticketId}</code>
                      <span>
                        {conflict.kind === 'rejected'
                          ? `Rechazado: ${conflict.reason ?? 'sin motivo'}`
                          : `Ya usado · primer paso ${
                              conflict.firstScanAt
                                ? uiDateTime(new Date(conflict.firstScanAt))
                                : 'desconocido'
                            }${conflict.firstScanZoneId ? ` · puerta ${conflict.firstScanZoneId}` : ''}${
                              conflict.firstScanBy ? ` · operador ${conflict.firstScanBy}` : ''
                            }`}
                      </span>
                      <span className={styles.recentMeta}>
                        {uiTime(new Date(conflict.attemptedAt))}
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={styles.pill}
                  onClick={() => void clearConflicts().then(refreshLocal)}
                >
                  Marcar revisados
                </button>
              </div>
            </details>
          ) : null}

          <details className={styles.settings}>
            <summary>Qué valida sin red</summary>
            <ul className={styles.notes}>
              <li>Que el boleto pertenecía a la función al descargar la lista.</li>
              <li>El estado (vendido o ya usado) es el de ese momento.</li>
              <li>Detecta repetidos del mismo boleto en este equipo.</li>
              <li>Nada se pierde: se guarda y se concilia al volver la red.</li>
              <li>No verifica la firma del QR: esa validación vive en el servidor.</li>
              <li>No conoce reembolsos ni cancelaciones posteriores a la descarga.</li>
              <li>No detecta repetidos de otra puerta que también esté sin red.</li>
              <li>No resuelve códigos escritos a mano: la lista lleva el QR.</li>
            </ul>
          </details>
        </aside>
      </div>
    </PosShell>
  );
}

function EventPick({
  events,
  eventId,
  onChange,
}: {
  events: EventRow[];
  eventId: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = events.find((event) => event.id === eventId);
  const many = events.length > 12;
  const needle = query.trim().toLowerCase();
  const shown =
    many && needle ? events.filter((event) => event.title.toLowerCase().includes(needle)) : events;

  return (
    <div>
      <button
        type="button"
        className={styles.trigger}
        aria-label={`Cambiar función: ${current?.title ?? 'sin función'}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((next) => !next)}
      >
        {current?.title ?? 'Sin función'}
      </button>
      {open ? (
        <div className={styles.sheet} role="listbox" aria-label="Función">
          {many ? (
            <Field
              label="Buscar"
              kind="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}
          {shown.length === 0 ? <p className={styles.quiet}>No hay funciones.</p> : null}
          {shown.map((event) => (
            <button
              key={event.id}
              type="button"
              role="option"
              className={styles.option}
              aria-selected={event.id === eventId}
              onClick={() => {
                onChange(event.id);
                setOpen(false);
              }}
            >
              {event.title}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
