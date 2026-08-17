'use client';

/**
 * Control de accesos en puerta.
 *
 * Tres correcciones que importan más que el aspecto:
 *
 * 1. ANTES, sin red, la pantalla pintaba «✓ Acceso permitido» en verde para
 *    CUALQUIER código encolado, sin haberlo validado contra nada. En una puerta
 *    eso deja pasar a cualquiera: un boleto reembolsado, uno inventado o uno ya
 *    usado se veían idénticos a uno bueno. Ahora el encolado es un veredicto
 *    propio, ámbar y explícito: «sin validar».
 *
 * 2. «Ya escaneado» (409) y «no válido» (400) eran el mismo mensaje gris. Son
 *    decisiones distintas: el primero es una posible reventa o un reingreso y se
 *    resuelve hablando con la persona; el segundo es rechazo directo. El 409 del
 *    API trae hora, puerta y operador del primer escaneo, y ahora se muestran.
 *
 * 3. `scannedBy` se mandaba desde el cliente. El API lo ignora (lo toma del JWT)
 *    desde el endurecimiento, así que enviarlo solo simulaba una trazabilidad
 *    que no existía.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, adminApi, getStoredToken } from '@/lib/api';
import { CameraScanner } from './CameraScanner';
import styles from './scanner.module.scss';

const QUEUE_KEY = 'boletera_offline_scans';
const ZONE_KEY = 'boletera_scanner_zone';

type QueuedScan = {
  id: string;
  raw: string;
  at: string;
  /** Sólo disponible cuando el origen fue un QR: el payload lleva el id. */
  ticketId?: string;
  zoneId?: string;
};

/** Veredicto que ve el operador. El color y el texto salen de aquí, no del HTTP. */
type Verdict =
  | { kind: 'granted'; code?: string; eventTitle?: string; seat?: string }
  | { kind: 'duplicate'; firstScanAt?: string; firstScanZoneId?: string; firstScanBy?: string }
  | { kind: 'invalid'; reason: string }
  | { kind: 'queued'; pending: number }
  | { kind: 'localDuplicate'; at: string }
  | { kind: 'error'; reason: string };

function readQueue(): QueuedScan[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') as QueuedScan[];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedScan[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

/** El QR trae `{v,t,e,s}`; `t` es el ticketId, que la sincronización necesita. */
function extractTicketId(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as { t?: string };
    return typeof parsed.t === 'string' ? parsed.t : undefined;
  } catch {
    return undefined;
  }
}

function scanBody(raw: string) {
  const trimmed = raw.trim();
  return trimmed.startsWith('{') ? { qrPayload: trimmed } : { ticketCode: trimmed };
}

function formatMoment(iso?: string) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'medium' }).format(date);
}

/**
 * Realimentación sin mirar: en una puerta con fila el operador no lee la
 * pantalla en cada persona. Dos pitidos graves y una vibración larga para el
 * rechazo, uno corto y agudo para el paso.
 */
function feedback(ok: boolean) {
  try {
    navigator.vibrate?.(ok ? 60 : [90, 70, 90]);
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.12 : 0.3));
    osc.onended = () => void ctx.close();
  } catch {
    /* sin audio disponible: la pantalla sigue siendo la fuente de verdad */
  }
}

export default function ScannerPage() {
  const [code, setCode] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [loading, setLoading] = useState(false);
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(true);
  const [zoneId, setZoneId] = useState('');
  const [syncReport, setSyncReport] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Códigos ya vistos en ESTE dispositivo. Sin red es la única defensa contra
   * el mismo QR presentado dos veces en la misma puerta; entre puertas distintas
   * el duplicado sólo aparece al sincronizar.
   */
  const seenRef = useRef(new Map<string, string>());

  useEffect(() => {
    setOnline(navigator.onLine);
    setQueued(readQueue().length);
    setZoneId(localStorage.getItem(ZONE_KEY) ?? '');
    for (const item of readQueue()) seenRef.current.set(item.raw, item.at);

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const persistZone = useCallback((value: string) => {
    setZoneId(value);
    localStorage.setItem(ZONE_KEY, value);
  }, []);

  /**
   * Envía la cola. Los escaneos con `ticketId` van por `/access/scans/sync`,
   * que conserva la hora REAL del escaneo y devuelve los conflictos en vez de
   * abortar el lote. Los códigos tecleados a mano no tienen ticketId, así que
   * se reintentan por `/access/scan` y pierden la marca de tiempo original.
   */
  const flushQueue = useCallback(async () => {
    const token = getStoredToken();
    if (!token || !navigator.onLine) return;
    const items = readQueue();
    if (!items.length) return;

    setSyncReport(null);
    const withId = items.filter((i) => i.ticketId);
    const withoutId = items.filter((i) => !i.ticketId);
    const remaining: QueuedScan[] = [];
    let applied = 0;
    let conflicts = 0;
    let rejected = 0;

    if (withId.length) {
      try {
        const res = await adminApi<{
          applied?: unknown[];
          conflicts?: unknown[];
          rejected?: unknown[];
        }>('/access/scans/sync', token, {
          method: 'POST',
          body: JSON.stringify({
            scans: withId.map((i) => ({
              ticketId: i.ticketId,
              scannedAt: i.at,
              zoneId: i.zoneId || undefined,
            })),
          }),
        });
        applied += res.applied?.length ?? 0;
        conflicts += res.conflicts?.length ?? 0;
        rejected += res.rejected?.length ?? 0;
      } catch {
        remaining.push(...withId);
      }
    }

    for (const item of withoutId) {
      try {
        await adminApi('/access/scan', token, {
          method: 'POST',
          body: JSON.stringify({
            ...scanBody(item.raw),
            channel: 'ADMIN',
            zoneId: item.zoneId || undefined,
          }),
        });
        applied += 1;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) conflicts += 1;
        else if (e instanceof ApiError && e.status < 500) rejected += 1;
        else remaining.push(item);
      }
    }

    writeQueue(remaining);
    setQueued(remaining.length);
    setSyncReport(
      `Sincronizados ${applied} · ${conflicts} en conflicto · ${rejected} rechazados` +
        (remaining.length ? ` · ${remaining.length} siguen en cola` : ''),
    );
  }, []);

  useEffect(() => {
    if (online) void flushQueue();
  }, [online, flushQueue]);

  const runScan = useCallback(
    async (raw: string) => {
      const token = getStoredToken();
      const trimmed = raw.trim();
      if (!token || !trimmed) return;
      setLoading(true);
      setVerdict(null);
      setSyncReport(null);

      // Duplicado local: se detecta con o sin red, y es el único control que
      // existe estando sin conexión.
      const seenAt = seenRef.current.get(trimmed);
      if (seenAt) {
        setVerdict({ kind: 'localDuplicate', at: seenAt });
        feedback(false);
        setCode('');
        setLoading(false);
        inputRef.current?.focus();
        return;
      }

      if (!navigator.onLine) {
        const now = new Date().toISOString();
        const queue = readQueue();
        queue.push({
          id: crypto.randomUUID(),
          raw: trimmed,
          at: now,
          ticketId: extractTicketId(trimmed),
          zoneId: zoneId || undefined,
        });
        writeQueue(queue);
        seenRef.current.set(trimmed, now);
        setQueued(queue.length);
        // NO es «acceso permitido»: no se validó nada.
        setVerdict({ kind: 'queued', pending: queue.length });
        feedback(false);
        setCode('');
        setLoading(false);
        inputRef.current?.focus();
        return;
      }

      try {
        const res = await adminApi<{
          success: boolean;
          ticket?: { code: string; eventTitle: string; section?: string; row?: string; seatNumber?: string };
        }>('/access/scan', token, {
          method: 'POST',
          body: JSON.stringify({
            ...scanBody(trimmed),
            channel: 'ADMIN',
            zoneId: zoneId || undefined,
          }),
        });
        seenRef.current.set(trimmed, new Date().toISOString());
        const seat = [res.ticket?.section, res.ticket?.row, res.ticket?.seatNumber]
          .filter(Boolean)
          .join(' · ');
        setVerdict({
          kind: 'granted',
          code: res.ticket?.code,
          eventTitle: res.ticket?.eventTitle,
          seat: seat || undefined,
        });
        feedback(true);
        setCode('');
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const body = (e.body ?? {}) as {
            firstScanAt?: string;
            firstScanZoneId?: string;
            firstScanBy?: string;
          };
          setVerdict({ kind: 'duplicate', ...body });
        } else if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
          setVerdict({ kind: 'invalid', reason: e.userMessage });
        } else {
          setVerdict({
            kind: 'error',
            reason: e instanceof Error ? e.message : 'No se pudo validar',
          });
        }
        feedback(false);
      } finally {
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [zoneId],
  );

  /** Texto plano del veredicto, para que el lector de pantalla lo anuncie. */
  const spoken = useMemo(() => {
    if (!verdict) return '';
    switch (verdict.kind) {
      case 'granted':
        return `Acceso permitido. ${verdict.eventTitle ?? ''} ${verdict.seat ?? ''}`.trim();
      case 'duplicate':
        return `Boleto ya escaneado${
          formatMoment(verdict.firstScanAt) ? ` el ${formatMoment(verdict.firstScanAt)}` : ''
        }.`;
      case 'localDuplicate':
        return `Ya escaneado en este dispositivo el ${formatMoment(verdict.at) ?? ''}.`;
      case 'invalid':
        return `Boleto no válido. ${verdict.reason}`;
      case 'queued':
        return `Sin conexión: escaneo encolado sin validar. ${verdict.pending} pendientes.`;
      default:
        return `Error: ${verdict.reason}`;
    }
  }, [verdict]);

  return (
    <div className={styles.page}>
      <h1>Control de acceso</h1>

      <p className={styles.hint}>
        <span className={online ? styles.pillOnline : styles.pillOffline}>
          {online ? 'En línea' : 'Sin conexión'}
        </span>
        {queued > 0 && <span className={styles.pillQueued}>{queued} sin sincronizar</span>}
      </p>

      {!online && (
        <p className={styles.warnBanner} role="status">
          Sin conexión los escaneos <strong>no se validan</strong>: se guardan y se revisan al
          sincronizar. Sólo se detectan repetidos de esta misma puerta.
        </p>
      )}

      <div className={styles.field}>
        <label htmlFor="zone">Puerta o zona</label>
        <input
          id="zone"
          value={zoneId}
          onChange={(e) => persistZone(e.target.value)}
          placeholder="Identificador de la zona de acceso"
          autoComplete="off"
        />
      </div>

      <CameraScanner onScan={runScan} disabled={loading} />

      <div className={styles.field}>
        <label htmlFor="code">Código del boleto</label>
        <textarea
          id="code"
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            // El lector HID termina con Enter: validar sin tocar el ratón.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void runScan(code);
            }
          }}
          placeholder="BLT-… o el contenido del QR"
          rows={3}
        />
      </div>

      <div className={styles.actions}>
        <button type="button" onClick={() => void runScan(code)} disabled={loading || !code.trim()}>
          {loading ? 'Validando…' : 'Validar entrada'}
        </button>
        {queued > 0 && online && (
          <button type="button" onClick={() => void flushQueue()} className={styles.secondary}>
            Sincronizar {queued}
          </button>
        )}
      </div>

      {syncReport && (
        <p className={styles.hint} role="status">
          {syncReport}
        </p>
      )}

      {/* assertive: en una puerta el veredicto no puede esperar a que el lector
          termine lo que estaba diciendo. */}
      <div aria-live="assertive" className={styles.srOnly}>
        {spoken}
      </div>

      {verdict?.kind === 'granted' && (
        <div className={styles.ok}>
          <strong>✓ Acceso permitido</strong>
          {verdict.eventTitle && <p>{verdict.eventTitle}</p>}
          {verdict.seat && <p className={styles.seat}>{verdict.seat}</p>}
          {verdict.code && <code>{verdict.code}</code>}
        </div>
      )}

      {verdict?.kind === 'duplicate' && (
        <div className={styles.duplicate}>
          <strong>⟳ Boleto ya escaneado</strong>
          <p>No es un boleto falso: ya se usó para entrar. Verifica con la persona.</p>
          <ul>
            {formatMoment(verdict.firstScanAt) && (
              <li>Primer escaneo: {formatMoment(verdict.firstScanAt)}</li>
            )}
            {verdict.firstScanZoneId && <li>Puerta: {verdict.firstScanZoneId}</li>}
            {verdict.firstScanBy && <li>Operador: {verdict.firstScanBy}</li>}
          </ul>
        </div>
      )}

      {verdict?.kind === 'localDuplicate' && (
        <div className={styles.duplicate}>
          <strong>⟳ Repetido en esta puerta</strong>
          <p>Se escaneó aquí mismo el {formatMoment(verdict.at)}.</p>
        </div>
      )}

      {verdict?.kind === 'queued' && (
        <div className={styles.queued}>
          <strong>⏸ Encolado sin validar</strong>
          <p>
            No hay conexión, así que <strong>no se comprobó</strong> si el boleto es válido.
            Quedan {verdict.pending} por sincronizar.
          </p>
        </div>
      )}

      {verdict?.kind === 'invalid' && (
        <div className={styles.error}>
          <strong>✕ Boleto no válido</strong>
          <p>{verdict.reason}</p>
        </div>
      )}

      {verdict?.kind === 'error' && (
        <div className={styles.error}>
          <strong>No se pudo validar</strong>
          <p>{verdict.reason}</p>
        </div>
      )}
    </div>
  );
}
