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

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Field, NamedStatus, ParameterCard, TicketButton } from '@boletera/ui';
import { ApiError, adminApi, getStoredToken } from '@/lib/api';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param } from '../events/_ticket/controls';
import frame from '../events/_ticket/frame.module.scss';
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
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <ScannerBody />
      </AdminFrame>
    </Suspense>
  );
}

function ScannerBody() {
  const [code, setCode] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [loading, setLoading] = useState(false);
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(true);
  const [zoneId, setZoneId] = useState('');
  const [syncReport, setSyncReport] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
        return `Éxito. ${verdict.eventTitle ?? ''} ${verdict.seat ?? ''}`.trim();
      case 'duplicate':
        return `Rechazo. Boleto ya escaneado${
          formatMoment(verdict.firstScanAt) ? ` el ${formatMoment(verdict.firstScanAt)}` : ''
        }.`;
      case 'localDuplicate':
        return `Rechazo. Ya escaneado en este equipo el ${formatMoment(verdict.at) ?? ''}.`;
      case 'invalid':
        return `Rechazo. ${verdict.reason}`;
      case 'queued':
        return `Pendiente. Sin conexión: el escaneo no se validó. ${verdict.pending} por sincronizar.`;
      default:
        return `No se guardó. ${verdict.reason}`;
    }
  }, [verdict]);

  const rejection = rejectionCopy(verdict);

  return (
    <section>
      <header className={frame.sectionHead}>
        <h1 className={frame.sectionTitle}>Escáner</h1>
        <p className={frame.quiet}>Pega el código o usa el lector.</p>
      </header>

      {!online ? (
        <p className={frame.danger} role="status">
          Sin conexión los escaneos no se validan. Se guardan y se revisan al sincronizar. Solo se
          detectan repetidos de esta misma puerta.
        </p>
      ) : null}

      <div className={frame.stack}>
        <Param name="Zona del escaneo">
          <ParameterCard
            name="Zona del escaneo"
            value={zoneId.trim() || '—'}
            valueStyle="mono"
            effect="Si se escribe, tiene que ser una zona que ya existe. Vacío, el escaneo no lleva zona."
          >
            <Field
              id="zone"
              label="Identificador de la zona"
              value={zoneId}
              onChange={(event) => persistZone(event.target.value)}
              placeholder="Identificador de la zona"
              autoComplete="off"
            />
          </ParameterCard>
        </Param>
        <Param name="Canal del escaneo">
          <ParameterCard
            name="Canal del escaneo"
            value="Admin"
            effect="El escaneo de esta pantalla sale por administración."
          />
        </Param>
        <Param name="Código del boleto">
          <ParameterCard
            name="Código del boleto"
            value={code.trim() || '—'}
            valueStyle="mono"
            effect="Lector HID, o el contenido del QR."
          >
            <Field
              id="code"
              ref={inputRef}
              label="Código"
              value={code}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="Código del boleto"
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void runScan(code);
                }
              }}
            />
          </ParameterCard>
        </Param>

        {verdict?.kind === 'granted' ? (
          <Param name="Resultado">
            <ParameterCard
              name="Resultado"
              value="Éxito"
              effect={verdict.eventTitle || 'Acceso registrado.'}
            />
          </Param>
        ) : null}
        {verdict?.kind === 'granted' && verdict.seat ? (
          <ParameterCard name="Butaca" value={verdict.seat} valueStyle="mono" effect="Sección, fila y número." />
        ) : null}
        {verdict?.kind === 'granted' && verdict.code ? (
          <ParameterCard name="Folio" value={verdict.code} valueStyle="mono" effect="Código del boleto." />
        ) : null}
        {verdict?.kind === 'queued' ? (
          <Param name="Resultado">
            <ParameterCard
              name="Resultado"
              value={<NamedStatus status="pendiente" />}
              effect={`No se comprobó el boleto. Quedan ${verdict.pending} por sincronizar.`}
            />
          </Param>
        ) : null}
        {rejection ? (
          <Param name="Resultado">
            <ParameterCard name="Resultado" value="Rechazo" effect={rejection.effect} />
          </Param>
        ) : null}
        {rejection?.reason ? (
          <Param name="Motivo del rechazo">
            <ParameterCard name="Motivo del rechazo" value={rejection.reason} effect="Lo que devolvió el acceso." />
          </Param>
        ) : null}
        {verdict?.kind === 'error' ? (
          <p className={frame.danger} role="alert">
            No se guardó. Revisa la conexión. {verdict.reason}
          </p>
        ) : null}
      </div>

      {syncReport ? (
        <p className={frame.quiet} role="status">
          {syncReport}
        </p>
      ) : null}

      <div aria-live="assertive" className={styles.srOnly}>
        {spoken}
      </div>

      <div className={styles.secondaryRow}>
        <CameraScanner onScan={runScan} disabled={loading} />
        {queued > 0 && online ? (
          <TicketButton variant="secondary" onClick={() => void flushQueue()}>
            Sincronizar {queued}
          </TicketButton>
        ) : null}
      </div>

      <div className={frame.saveBar}>
        <p className={frame.quiet}>
          {loading ? 'Validando…' : online ? 'En línea' : 'Sin conexión'}
          {queued > 0 ? ` · ${queued} en cola` : ''}
        </p>
        <TicketButton disabled={loading || !code.trim()} onClick={() => void runScan(code)}>
          Validar entrada
        </TicketButton>
      </div>
    </section>
  );
}

function rejectionCopy(
  verdict: Verdict | null,
): { effect: string; reason: string } | null {
  if (!verdict) return null;
  if (verdict.kind === 'duplicate') {
    const when = formatMoment(verdict.firstScanAt);
    const bits = [
      when ? `Primer escaneo ${when}` : null,
      verdict.firstScanZoneId ? `Puerta ${verdict.firstScanZoneId}` : null,
      verdict.firstScanBy ? `Operador ${verdict.firstScanBy}` : null,
    ].filter(Boolean);
    return {
      effect: 'Ya se usó para entrar. Verifica con la persona.',
      reason: bits.join(' · ') || 'Ya escaneado.',
    };
  }
  if (verdict.kind === 'localDuplicate') {
    return {
      effect: 'Repetido en esta puerta.',
      reason: `Se escaneó aquí el ${formatMoment(verdict.at) ?? '—'}.`,
    };
  }
  if (verdict.kind === 'invalid') {
    return { effect: 'El boleto no sirve para entrar.', reason: verdict.reason };
  }
  return null;
}
