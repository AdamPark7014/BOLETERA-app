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
import { Field, TicketButton } from '@boletera/ui';
import { ApiError, adminApi, getStoredToken } from '@/lib/api';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { SheetSelect } from '../events/_ticket/controls';
import { CameraScanner } from './CameraScanner';
import styles from './scanner.module.scss';

const QUEUE_KEY = 'boletera_offline_scans';
const ZONE_KEY = 'boletera_scanner_zone';
const EVENT_KEY = 'boletera_scanner_event';

type GateEvent = { id: string; title: string; startsAt: string };

type QueuedScan = {
  id: string;
  raw: string;
  at: string;
  /** Sólo disponible cuando el origen fue un QR: el payload lleva el id. */
  ticketId?: string;
  zoneId?: string;
  eventId?: string;
};

/** Veredicto que ve el operador. El color y el texto salen de aquí, no del HTTP. */
type Verdict =
  | {
      kind: 'granted';
      code?: string;
      eventTitle?: string;
      seat?: string;
      section?: string;
      row?: string;
      seatNumber?: string;
    }
  | { kind: 'duplicate'; firstScanAt?: string; firstScanZoneId?: string; firstScanBy?: string }
  | {
      kind: 'invalid';
      reason: string;
      /** 400 WRONG_EVENT: boleto bueno, función equivocada. */
      wrongEvent?: boolean;
      eventTitle?: string;
      /** Falta algo de la puerta (función), no del boleto. */
      operator?: boolean;
      notFound?: boolean;
    }
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
  const [eventId, setEventId] = useState('');
  const [events, setEvents] = useState<GateEvent[]>([]);
  const [syncReport, setSyncReport] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastRaw, setLastRaw] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [supervisorOpen, setSupervisorOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** Últimos veredictos de esta sesión, para contadores y lista (el API no da totales por puerta). */
  const [log, setLog] = useState<
    Array<{ at: number; tone: 'ok' | 'bad' | 'warn'; label: string; seat?: string }>
  >([]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!verdict) return;
    const view = verdictView(verdict);
    if (view.tone === 'idle') return;
    setDetailsOpen(false);
    setSupervisorOpen(false);
    setNow(Date.now());
    setLog((prev) =>
      [
        {
          at: Date.now(),
          tone: view.tone as 'ok' | 'bad' | 'warn',
          label: verdict.kind === 'granted' ? verdict.code || 'Adelante' : view.title.toLowerCase(),
          seat: verdict.kind === 'granted' ? verdict.seat : undefined,
        },
        ...prev,
      ].slice(0, 500)
    );
  }, [verdict]);

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
    setEventId(localStorage.getItem(EVENT_KEY) ?? '');
    const token = getStoredToken();
    if (token) {
      // Funciones de la organización del operador (JWT). La puerta controla UNA:
      // sin ella el API aceptaba boletos de cualquier otro evento.
      adminApi<GateEvent[]>('/taquilla/events', token)
        .then((list) => setEvents(Array.isArray(list) ? list : []))
        .catch(() => setEvents([]));
    }
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

  const persistEvent = useCallback((value: string) => {
    setEventId(value);
    localStorage.setItem(EVENT_KEY, value);
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
            eventId: item.eventId || undefined,
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
        (remaining.length ? ` · ${remaining.length} siguen en cola` : '')
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
      setLastRaw(trimmed);
      if (!eventId) {
        setVerdict({
          kind: 'invalid',
          reason: 'Elige la función de esta puerta antes de escanear.',
          operator: true,
        });
        feedback(false);
        return;
      }
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
          eventId,
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
          ticket?: {
            code: string;
            eventTitle: string;
            section?: string;
            row?: string;
            seatNumber?: string;
          };
        }>('/access/scan', token, {
          method: 'POST',
          body: JSON.stringify({
            ...scanBody(trimmed),
            channel: 'ADMIN',
            zoneId: zoneId || undefined,
            eventId,
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
          section: res.ticket?.section || undefined,
          row: res.ticket?.row || undefined,
          seatNumber: res.ticket?.seatNumber || undefined,
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
          const body = (e.body ?? {}) as { code?: string; ticketEventTitle?: string };
          setVerdict({
            kind: 'invalid',
            reason: e.userMessage,
            wrongEvent: body.code === 'WRONG_EVENT',
            eventTitle: body.ticketEventTitle,
            notFound: e.status === 404,
          });
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
    [zoneId, eventId]
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

  const view = verdictView(verdict);
  const okCount = log.filter((r) => r.tone === 'ok').length;
  const rejectCount = log.filter((r) => r.tone === 'bad').length;
  const perMinute = log.filter((r) => r.tone === 'ok' && now - r.at <= 60_000).length;
  const currentEvent = events.find((e) => e.id === eventId);
  const nextScan = () => {
    setVerdict(null);
    setDetailsOpen(false);
    setSupervisorOpen(false);
    setCode('');
    inputRef.current?.focus();
  };

  return (
    <section className={styles.gate}>
      <header className={styles.gateHead}>
        <div>
          <h1 className={styles.gateTitle}>Escáner</h1>
          <p className={styles.gateSub}>
            {currentEvent ? currentEvent.title : 'Elige la función de esta puerta'}
            {zoneId.trim() ? ` · puerta ${zoneId.trim()}` : ''}
          </p>
        </div>
        <span className={online && queued === 0 ? styles.netOk : styles.netWarn}>
          <span className={styles.netDot} aria-hidden="true" />
          {online ? 'En línea' : 'Sin red'}
          {queued > 0 ? ` · ${queued} por subir` : ''}
        </span>
      </header>

      <div className={styles.gateGrid}>
        <div className={styles.gateMain}>
          <form
            className={styles.scanRow}
            onSubmit={(event) => {
              event.preventDefault();
              void runScan(code);
            }}
          >
            <label className={styles.scanField}>
              <span>Código del boleto</span>
              <input
                id="code"
                ref={inputRef}
                value={code}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder="Escanea el QR o escribe el código"
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <button type="submit" className={styles.validate} disabled={loading || !code.trim()}>
              {loading ? 'Validando…' : 'Validar'}
            </button>
          </form>

          <div
            className={
              view.tone === 'ok'
                ? styles.resultOk
                : view.tone === 'bad'
                  ? styles.resultBad
                  : view.tone === 'warn'
                    ? styles.resultWarn
                    : styles.resultIdle
            }
          >
            {view.tone === 'idle' ? (
              <>
                <svg aria-hidden="true" className={styles.iconIdle} viewBox="0 0 24 24">
                  <path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M7 12h10" />
                </svg>
                <p className={styles.idleTitle}>
                  {eventId ? 'Listo para escanear' : 'Elige la función'}
                </p>
                <p className={styles.idleText}>
                  {eventId
                    ? 'Usa el lector, la cámara o escribe el código y pulsa Enter.'
                    : 'Sólo entran boletos de la función elegida.'}
                </p>
              </>
            ) : (
              <>
                <svg aria-hidden="true" className={styles.icon} viewBox="0 0 24 24">
                  <path
                    d={
                      view.tone === 'ok'
                        ? 'M5 12.5l4.5 4.5L19 7.5'
                        : view.tone === 'bad'
                          ? 'M6 6l12 12M18 6L6 18'
                          : 'M12 7v6M12 17h.01'
                    }
                  />
                </svg>
                <p className={styles.verdictWord}>{view.title}</p>
                {verdict?.kind === 'granted' ? (
                  <>
                    <p className={styles.holder}>{verdict.eventTitle || 'Acceso registrado'}</p>
                    <div className={styles.seatRow}>
                      {verdict.section || verdict.row || verdict.seatNumber ? (
                        <>
                          {verdict.section ? (
                            <span className={styles.seatChip}>
                              <small>Sección</small>
                              <strong>{verdict.section}</strong>
                            </span>
                          ) : null}
                          {verdict.row ? (
                            <span className={styles.seatChip}>
                              <small>Fila</small>
                              <strong>{verdict.row}</strong>
                            </span>
                          ) : null}
                          {verdict.seatNumber ? (
                            <span className={styles.seatChip}>
                              <small>Asiento</small>
                              <strong>{verdict.seatNumber}</strong>
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className={styles.seatChip}>
                          <small>Acceso</small>
                          <strong>General</strong>
                        </span>
                      )}
                    </div>
                    {verdict.code ? <code className={styles.code}>{verdict.code}</code> : null}
                  </>
                ) : (
                  <>
                    <p className={styles.reason}>{view.detail}</p>
                    {view.sub ? <p className={styles.reasonSub}>{view.sub}</p> : null}
                    {view.tone === 'bad' ? (
                      <div className={styles.resultActions}>
                        <button
                          type="button"
                          className={styles.whiteBtn}
                          onClick={() => setSupervisorOpen((v) => !v)}
                        >
                          Llamar supervisor
                        </button>
                        {lastRaw ? (
                          <button
                            type="button"
                            className={styles.ghostBtn}
                            aria-expanded={detailsOpen}
                            onClick={() => setDetailsOpen((v) => !v)}
                          >
                            Ver boleto
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {detailsOpen && lastRaw ? (
                      <dl className={styles.ticketData}>
                        <dt>Código leído</dt>
                        <dd>{lastRaw}</dd>
                        {currentEvent ? (
                          <>
                            <dt>Puerta de</dt>
                            <dd>{currentEvent.title}</dd>
                          </>
                        ) : null}
                      </dl>
                    ) : null}
                    {supervisorOpen ? (
                      <div className={styles.ticketData}>
                        <p>
                          Dicta al supervisor por radio: «{view.title.toLowerCase()}», {view.detail}
                          {zoneId.trim() ? ` Puerta ${zoneId.trim()}.` : ''} Pide a la persona que
                          espere a un lado de la fila.
                        </p>
                      </div>
                    ) : null}
                  </>
                )}
              </>
            )}
          </div>

          <button type="button" className={styles.nextBtn} onClick={nextScan}>
            Escanear siguiente
          </button>

          {syncReport ? (
            <p className={styles.quiet} role="status">
              {syncReport}
            </p>
          ) : null}
        </div>

        <aside className={styles.gateSide}>
          <div className={styles.counters}>
            <div className={styles.counter}>
              <span>Entradas</span>
              <strong>{okCount.toLocaleString('es-MX')}</strong>
            </div>
            <div className={styles.counter}>
              <span>Por minuto</span>
              <strong>{perMinute.toLocaleString('es-MX')}</strong>
            </div>
            <div className={styles.counter}>
              <span>Rechazos</span>
              <strong>{rejectCount.toLocaleString('es-MX')}</strong>
            </div>
          </div>
          <p className={styles.counterNote}>Contadores de esta sesión en este equipo.</p>

          <div className={styles.sideBlock}>
            <h2 className={styles.label}>Últimos escaneos</h2>
            {log.length === 0 ? (
              <p className={styles.quiet}>Aún no hay escaneos en esta sesión.</p>
            ) : (
              <ul className={styles.recent}>
                {log.slice(0, 6).map((row) => (
                  <li key={row.at}>
                    <span
                      className={
                        row.tone === 'ok'
                          ? styles.dotOk
                          : row.tone === 'bad'
                            ? styles.dotBad
                            : styles.dotWarn
                      }
                      aria-hidden="true"
                    />
                    <span className={styles.recentMain}>{row.label}</span>
                    <span className={styles.recentMeta}>{row.seat || '—'}</span>
                    <span className={styles.recentMeta}>
                      {new Date(row.at).toLocaleTimeString('es-MX', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.sideBlock}>
            <h2 className={styles.label}>Puerta</h2>
            <SheetSelect
              label="Función"
              value={eventId}
              placeholder="Elige la función"
              options={events.map((e) => ({
                value: e.id,
                label: `${e.title} · ${new Date(e.startsAt).toLocaleDateString('es-MX', {
                  day: 'numeric',
                  month: 'short',
                })}`,
              }))}
              onChange={persistEvent}
            />
            <Field
              id="zone"
              label="Zona de acceso"
              hint="Vacío si la puerta no tiene zona registrada"
              value={zoneId}
              onChange={(event) => persistZone(event.target.value)}
              placeholder="Identificador de la zona"
              autoComplete="off"
            />
          </div>

          <div className={styles.sideBlock}>
            <CameraScanner onScan={runScan} disabled={loading} />
            {queued > 0 && online ? (
              <TicketButton variant="secondary" onClick={() => void flushQueue()}>
                Subir {queued} {queued === 1 ? 'escaneo' : 'escaneos'}
              </TicketButton>
            ) : null}
            {!online ? (
              <p className={styles.quiet}>
                Sin red los escaneos no se validan: se guardan y se revisan al volver la conexión.
                Sólo se detectan repetidos de esta misma puerta.
              </p>
            ) : null}
          </div>
        </aside>
      </div>

      <div aria-live="assertive" className={styles.srOnly}>
        {spoken}
      </div>
    </section>
  );
}

type View = { tone: 'idle' | 'ok' | 'bad' | 'warn'; title: string; detail: string; sub?: string };

function agoLabel(iso?: string) {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const mins = Math.max(0, Math.round((Date.now() - at.getTime()) / 60000));
  const hour = at.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  if (mins < 1) return `hace menos de un minuto (${hour})`;
  if (mins < 120) return `hace ${mins} min (${hour})`;
  return `el ${formatMoment(iso)}`;
}

/** Palabra grande, motivo y color de cada veredicto (maquetas Escaner y EscanerNo). */
function verdictView(verdict: Verdict | null): View {
  if (!verdict) return { tone: 'idle', title: '', detail: '' };
  switch (verdict.kind) {
    case 'granted':
      return { tone: 'ok', title: 'Adelante', detail: verdict.eventTitle ?? '' };
    case 'duplicate': {
      const when = agoLabel(verdict.firstScanAt);
      return {
        tone: 'bad',
        title: 'Ya entró',
        detail: `Este boleto se usó ${when ?? 'antes'}${
          verdict.firstScanZoneId ? ` en la puerta ${verdict.firstScanZoneId}` : ''
        }.`,
        sub: verdict.firstScanBy
          ? `Lo escaneó ${verdict.firstScanBy}. Posible reventa o reingreso.`
          : 'Posible reventa o reingreso. Habla con la persona.',
      };
    }
    case 'localDuplicate':
      return {
        tone: 'bad',
        title: 'Ya entró',
        detail: `Pasó por esta puerta ${agoLabel(verdict.at) ?? 'antes'}.`,
        sub: 'Repetido detectado en este equipo.',
      };
    case 'invalid':
      if (verdict.wrongEvent) {
        return {
          tone: 'bad',
          title: 'Otra función',
          detail: verdict.eventTitle
            ? `Este boleto es de «${verdict.eventTitle}».`
            : 'Este boleto es de otra función.',
          sub: 'No se marcó como usado. Indica al portador su puerta o fecha.',
        };
      }
      if (verdict.operator) {
        return { tone: 'warn', title: 'Elige la función', detail: verdict.reason };
      }
      return {
        tone: 'bad',
        title: 'No válido',
        detail: verdict.notFound ? 'Ese código no existe en el sistema.' : verdict.reason,
        sub: verdict.notFound
          ? 'Posible boleto falso o mal escrito.'
          : 'Cancelado, reembolsado, transferido o QR alterado.',
      };
    case 'queued':
      return {
        tone: 'warn',
        title: 'Sin validar',
        detail: 'Sin red: el escaneo quedó guardado pero NO se comprobó el boleto.',
        sub: `${verdict.pending} por subir. Si dudas, llama a supervisión.`,
      };
    default:
      return {
        tone: 'warn',
        title: 'No se guardó',
        detail: verdict.reason,
        sub: 'Revisa la conexión y vuelve a escanear.',
      };
  }
}
