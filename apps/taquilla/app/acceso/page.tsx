'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BlackTicketRoot,
  Field,
  NamedStatus,
  ParameterCard,
  TicketButton,
} from '@boletera/ui';
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
};

const ZONE_KEY = 'taquilla_access_zone';

function resultWord(verdict: Verdict): 'Éxito' | 'Rechazo' | 'Pendiente' {
  if (verdict === 'OK' || verdict === 'OFFLINE_OK') return 'Éxito';
  if (verdict === 'OFFLINE_UNVERIFIABLE') return 'Pendiente';
  return 'Rechazo';
}

export default function AccesoPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventId, setEventId] = useState('');
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

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 4000);
  }, []);

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
  }, [router]);

  useEffect(() => {
    setZoneId(localStorage.getItem(ZONE_KEY) || '');
    apiJson<EventRow[]>('/discovery/events')
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
    [manifests, eventId],
  );

  const pushOutcome = useCallback((next: ScanOutcomeView) => {
    setOutcome(next);
    setHistory((prev) => [next, ...prev].slice(0, 8));
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
        `${result.applied} aplicados · ${result.conflicts} conflictos · ${result.rejected} rechazados`,
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo sincronizar');
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
      showToast(`Manifiesto listo: ${meta.count} boletos`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo descargar el manifiesto');
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
          title: 'NO SE PUEDE VERIFICAR',
          detail: 'Sin red sólo se puede validar el QR. Un código escrito a mano no está en el manifiesto local.',
          at: Date.now(),
        });
        return;
      }

      const previous = await getLocalScan(qr.ticketId);
      if (previous) {
        pushOutcome({
          verdict: 'DUPLICATE',
          title: 'YA ESCANEADO AQUÍ',
          detail: `Primer paso en esta puerta: ${new Date(previous.scannedAt).toLocaleTimeString('es-MX')}`,
          extra: 'Duplicado detectado en local. Llama a supervisión.',
          at: Date.now(),
        });
        return;
      }

      const entry = await lookupManifestEntry(qr.ticketId);
      const scannedAt = new Date().toISOString();

      if (!entry) {
        pushOutcome({
          verdict: 'UNKNOWN',
          title: 'NO ESTÁ EN EL MANIFIESTO',
          detail: 'El boleto no pertenece al evento descargado o el manifiesto está incompleto.',
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

      if (entry.st === 'U') {
        pushOutcome({
          verdict: 'DUPLICATE',
          title: 'YA USADO',
          detail: 'El manifiesto lo tenía como usado al descargarse.',
          extra: 'Se registra igual y saldrá en conflictos al sincronizar.',
          at: Date.now(),
        });
      } else {
        pushOutcome({
          verdict: 'OFFLINE_OK',
          title: 'VÁLIDO (SIN RED)',
          detail: 'Pertenece al evento y estaba vendido al descargar el manifiesto.',
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
      });
      refreshLocal();
    },
    [pushOutcome, zoneId, refreshLocal],
  );

  const scan = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value || busy) return;
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
          const data = await apiJson<{ ticket?: { code?: string; section?: string | null; row?: string | null; seatNumber?: string | null; eventTitle?: string } }>(
            '/access/scan',
            {
              method: 'POST',
              body: JSON.stringify({ ...body, zoneId: zoneId || undefined }),
            },
          );
          const t = data.ticket;
          pushOutcome({
            verdict: 'OK',
            title: 'ADELANTE',
            detail: t
              ? [t.eventTitle, t.section, t.row ? `Fila ${t.row}` : null, t.seatNumber]
                  .filter(Boolean)
                  .join(' · ')
              : 'Acceso registrado',
            extra: t?.code,
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
          };
          if (err.status === 409 && payload.code === 'TICKET_ALREADY_SCANNED') {
            // 409 ≠ 400: "ya escaneado" se resuelve llamando a supervisión;
            // "no válido" se resuelve rechazando al portador.
            pushOutcome({
              verdict: 'DUPLICATE',
              title: 'YA ESCANEADO',
              detail: payload.firstScanAt
                ? `Primer paso: ${new Date(payload.firstScanAt).toLocaleString('es-MX')}`
                : 'Este boleto ya entró.',
              extra: [
                payload.firstScanZoneId ? `Puerta ${payload.firstScanZoneId}` : null,
                payload.firstScanBy ? `Operador ${payload.firstScanBy}` : null,
              ]
                .filter(Boolean)
                .join(' · '),
              at: Date.now(),
            });
            return;
          }
          if (err.status === 404) {
            pushOutcome({
              verdict: 'UNKNOWN',
              title: 'NO EXISTE',
              detail: 'Ese boleto no está en el sistema.',
              at: Date.now(),
            });
            return;
          }
          pushOutcome({
            verdict: 'INVALID',
            title: 'NO VÁLIDO',
            detail: payload.message || err.message,
            extra: 'Cancelado, reembolsado, transferido o QR alterado.',
            at: Date.now(),
          });
        }
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, zoneId, scanOffline, pushOutcome],
  );

  const hotkeys = useMemo<Hotkey[]>(
    () => [
      { keys: 'Enter', label: 'Escanear', displayOnly: true },
      {
        keys: 'F5',
        label: 'Descargar manifiesto',
        whileTyping: true,
        run: () => void doDownload(),
      },
      { keys: 'F8', label: 'Sincronizar cola', whileTyping: true, run: () => void runSync() },
      {
        keys: 'Esc',
        label: 'Salir',
        whileTyping: true,
        match: (e) => e.key === 'Escape',
        run: () => router.push('/'),
      },
    ],
    [doDownload, runSync, router],
  );

  const word = outcome ? resultWord(outcome.verdict) : null;

  return (
    <PosShell title="Puerta" backHref="/" size="md" hotkeys={hotkeys} escapeGoesBack={false}>
      <BlackTicketRoot density="admin" className={styles.root}>
      {toast ? (
        <p className={styles.toast} role="status">
          {toast}
        </p>
      ) : null}

      <p className={styles.lead}>Pega el código o usa el lector. Descarga el manifiesto antes de abrir sin red.</p>

      <div className={styles.stack}>
        <ParameterCard
          name="Función"
          value={events.find((event) => event.id === eventId)?.title ?? 'Sin función'}
          effect="El manifiesto y el escaneo son de esta función."
        >
          <EventPick events={events} eventId={eventId} onChange={setEventId} />
        </ParameterCard>
        <ParameterCard
          name="Zona de acceso"
          value={zoneId.trim() || '—'}
          valueStyle="mono"
          effect="Texto libre de esta ventanilla. Viaja con el escaneo."
        >
          <Field
            id="access-zone"
            label="Identificador"
            value={zoneId}
            onChange={(event) => {
              setZoneId(event.target.value);
              localStorage.setItem(ZONE_KEY, event.target.value);
            }}
            placeholder="Identificador de la zona"
            autoComplete="off"
          />
        </ParameterCard>
        <ParameterCard
          name="Manifiesto"
          value={
            manifest ? (manifest.complete ? 'Completo' : 'Incompleto') : 'Sin manifiesto'
          }
          effect={
            manifest
              ? `${manifest.count.toLocaleString('es-MX')} boletos · emitido ${new Date(manifest.issuedAt).toLocaleString('es-MX')}`
              : 'Sin él no se valida sin red.'
          }
        />
      </div>
      <div className={styles.secondary}>
        <TicketButton
          variant="secondary"
          disabled={downloading != null || !eventId}
          onClick={() => void doDownload()}
        >
          {downloading != null ? 'Descargando…' : 'Descargar manifiesto'}
        </TicketButton>
      </div>

      <ParameterCard
        name="Código del boleto"
        value={code.trim() || '—'}
        valueStyle="mono"
        effect="QR o código escrito."
      >
        <Field
          ref={inputRef}
          autoFocus
          id="access-scan"
          label="Código"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void scan(code);
            }
          }}
          placeholder="Código del boleto"
          autoComplete="off"
          spellCheck={false}
        />
      </ParameterCard>

      {outcome && word ? (
        <div role="status" aria-live="assertive">
          <ParameterCard
            name="Resultado"
            value={word === 'Pendiente' ? <NamedStatus status="pendiente" /> : word}
            effect={outcome.detail}
          />
          {outcome.extra ? (
            <ParameterCard
              name={word === 'Rechazo' ? 'Motivo del rechazo' : 'Nota'}
              value={outcome.extra}
              valueStyle="mono"
              effect="Lo que acompañó a este escaneo."
            />
          ) : null}
        </div>
      ) : null}

      <ParameterCard
        name="Cola"
        value={pending.toLocaleString('es-MX')}
        valueStyle="tabular"
        effect="Escaneos de esta puerta aún sin sincronizar."
      />
      <div className={styles.secondary}>
        <TicketButton variant="secondary" onClick={() => void runSync()}>
          Sincronizar
        </TicketButton>
      </div>

      {conflicts.length > 0 ? (
        <div className={styles.stack}>
          <p className={styles.quiet}>
            {conflicts.length} conflictos. El resto del lote sí se aplicó. Estos no.
          </p>
          <ul className={styles.rows}>
            {conflicts.slice(0, 25).map((conflict) => (
              <li key={conflict.id} className={styles.row}>
                <p className={styles.mono}>{conflict.ticketId}</p>
                <p className={styles.quiet}>
                  {conflict.kind === 'rejected'
                    ? `Rechazo: ${conflict.reason ?? 'sin motivo'}`
                    : `Ya usado · primer paso ${
                        conflict.firstScanAt
                          ? new Date(conflict.firstScanAt).toLocaleString('es-MX')
                          : 'desconocido'
                      }${conflict.firstScanZoneId ? ` · puerta ${conflict.firstScanZoneId}` : ''}${
                        conflict.firstScanBy ? ` · operador ${conflict.firstScanBy}` : ''
                      }`}
                </p>
                <p className={styles.mono}>{new Date(conflict.attemptedAt).toLocaleTimeString('es-MX')}</p>
              </li>
            ))}
          </ul>
          <TicketButton variant="secondary" onClick={() => void clearConflicts().then(refreshLocal)}>
            Marcar revisados
          </TicketButton>
        </div>
      ) : null}

      {history.length > 1 ? (
        <div className={styles.stack}>
          <p className={styles.quiet}>Últimos escaneos</p>
          <ul className={styles.rows}>
            {history.slice(1).map((item) => (
              <li key={item.at} className={styles.row}>
                <p className={styles.name}>
                  {resultWord(item.verdict) === 'Pendiente' ? (
                    <NamedStatus status="pendiente" />
                  ) : (
                    resultWord(item.verdict)
                  )}
                </p>
                <p className={styles.quiet}>{item.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={styles.stack}>
        <p className={styles.name}>Sin red</p>
        <ul className={styles.notes}>
          <li>El id pertenecía a la función cuando se descargó el manifiesto.</li>
          <li>El estado (vendido o ya usado) es el de ese instante.</li>
          <li>Detecta duplicados del mismo boleto en este equipo.</li>
          <li>Nada se pierde: se encola y se concilia al volver la red.</li>
          <li>No verifica la firma del QR. El secreto está en el servidor.</li>
          <li>No conoce reembolsos ni cancelaciones posteriores a la descarga.</li>
          <li>No detecta duplicados de otra puerta que también esté sin red.</li>
          <li>No resuelve códigos escritos a mano: el manifiesto lleva ids.</li>
        </ul>
      </div>

      <div className={styles.bar}>
        <p className={styles.quiet}>{busy ? 'Validando…' : `${pending.toLocaleString('es-MX')} en cola`}</p>
        <TicketButton disabled={busy || !code.trim()} onClick={() => void scan(code)}>
          Validar
        </TicketButton>
      </div>
      </BlackTicketRoot>
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
