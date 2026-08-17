'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
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

const VERDICT_TONE: Record<Verdict, 'ok' | 'warn' | 'bad'> = {
  OK: 'ok',
  OFFLINE_OK: 'ok',
  DUPLICATE: 'warn',
  OFFLINE_UNVERIFIABLE: 'warn',
  INVALID: 'bad',
  UNKNOWN: 'bad',
};

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

  function submit(e: FormEvent) {
    e.preventDefault();
    void scan(code);
  }

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

  const tone = outcome ? VERDICT_TONE[outcome.verdict] : null;

  return (
    <PosShell
      title="Control de acceso"
      eyebrow="Puerta"
      backHref="/"
      size="md"
      hotkeys={hotkeys}
      escapeGoesBack={false}
    >
      {toast && (
        <p className={styles.toast} role="status">
          {toast}
        </p>
      )}

      <section className={styles.setup}>
        <label className={styles.field}>
          <small>Evento</small>
          <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
            {events.length === 0 && <option value="">Sin eventos</option>}
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <small>Puerta / zona (opcional)</small>
          <input
            value={zoneId}
            onChange={(e) => {
              setZoneId(e.target.value);
              localStorage.setItem(ZONE_KEY, e.target.value);
            }}
            placeholder="id de zona de acceso"
          />
        </label>
      </section>

      <section className={styles.manifestBar}>
        <div className={styles.manifestInfo}>
          {manifest ? (
            <>
              <strong>
                Manifiesto: {manifest.count.toLocaleString('es-MX')} boletos
                {manifest.complete ? '' : ' (incompleto)'}
              </strong>
              <small>
                Emitido {new Date(manifest.issuedAt).toLocaleString('es-MX')} · descargado{' '}
                {new Date(manifest.downloadedAt).toLocaleString('es-MX')}
              </small>
            </>
          ) : (
            <>
              <strong>Sin manifiesto para este evento</strong>
              <small>Descárgalo ANTES de abrir puertas: sin él no se puede validar sin red.</small>
            </>
          )}
        </div>
        <button type="button" className={styles.action} onClick={() => void doDownload()} disabled={downloading != null || !eventId}>
          {downloading != null ? `Descargando… ${downloading.toLocaleString('es-MX')}` : 'Descargar · F5'}
        </button>
      </section>

      <form onSubmit={submit} className={styles.scanForm}>
        <input
          ref={inputRef}
          autoFocus
          className={styles.scanInput}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Escanea el QR o teclea el código…"
          aria-label="Código de boleto"
        />
        <button type="submit" className={styles.scanBtn} disabled={busy}>
          {busy ? '…' : 'Validar'}
        </button>
      </form>

      {outcome && (
        <section
          className={
            tone === 'ok' ? styles.verdictOk : tone === 'warn' ? styles.verdictWarn : styles.verdictBad
          }
          role="status"
          aria-live="assertive"
        >
          <strong>{outcome.title}</strong>
          <p>{outcome.detail}</p>
          {outcome.extra && <small>{outcome.extra}</small>}
        </section>
      )}

      <section className={styles.queueBar}>
        <span>
          <strong>{pending}</strong> escaneo{pending === 1 ? '' : 's'} en cola
        </span>
        <button type="button" className={styles.action} onClick={() => void runSync()}>
          Sincronizar · F8
        </button>
      </section>

      {conflicts.length > 0 && (
        <section className={styles.conflicts}>
          <header>
            <h2>{conflicts.length} conflictos de sincronización</h2>
            <button type="button" onClick={() => void clearConflicts().then(refreshLocal)}>
              Marcar revisados
            </button>
          </header>
          <p className={styles.conflictLead}>
            El API aplicó el resto del lote. Estos escaneos NO se aplicaron y operaciones debe
            revisarlos: no se ocultan.
          </p>
          <ul>
            {conflicts.slice(0, 25).map((c) => (
              <li key={c.id}>
                <code>{c.ticketId}</code>
                <span>
                  {c.kind === 'rejected'
                    ? `Rechazado: ${c.reason ?? 'sin motivo'}`
                    : `Ya usado · primer paso ${
                        c.firstScanAt ? new Date(c.firstScanAt).toLocaleString('es-MX') : 'desconocido'
                      }${c.firstScanZoneId ? ` · puerta ${c.firstScanZoneId}` : ''}${
                        c.firstScanBy ? ` · operador ${c.firstScanBy}` : ''
                      }`}
                </span>
                <em>intento {new Date(c.attemptedAt).toLocaleTimeString('es-MX')}</em>
              </li>
            ))}
          </ul>
        </section>
      )}

      {history.length > 1 && (
        <section className={styles.history}>
          <h2>Últimos escaneos</h2>
          <ul>
            {history.slice(1).map((h) => (
              <li key={h.at} className={styles[`tone${VERDICT_TONE[h.verdict]}`]}>
                <strong>{h.title}</strong>
                <span>{h.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.limits}>
        <h2>Qué garantiza el modo sin red — y qué no</h2>
        <ul className={styles.limitsOk}>
          <li>Que el id del boleto pertenecía al evento cuando se descargó el manifiesto.</li>
          <li>El estado (vendido / ya usado) en ese mismo instante.</li>
          <li>Duplicados del mismo boleto en ESTE dispositivo.</li>
          <li>Que ningún escaneo se pierde: todo se encola y se concilia al volver la red.</li>
        </ul>
        <ul className={styles.limitsNo}>
          <li>
            <strong>No verifica la firma rotativa del QR</strong>: el secreto vive en el servidor.
            Un QR fabricado con un id válido copiado pasaría sin red.
          </li>
          <li>
            <strong>No conoce reembolsos ni cancelaciones</strong> posteriores a la descarga del
            manifiesto.
          </li>
          <li>
            <strong>No detecta duplicados de otra puerta</strong> que también esté sin red: eso
            aparece en «conflictos» al sincronizar.
          </li>
          <li>
            <strong>No valida la firma del manifiesto en el dispositivo</strong> (mismo motivo);
            se guarda tal cual para auditoría.
          </li>
          <li>
            <strong>No resuelve códigos escritos a mano</strong>: el manifiesto lleva ids de boleto,
            no los códigos impresos.
          </li>
        </ul>
      </section>
    </PosShell>
  );
}
