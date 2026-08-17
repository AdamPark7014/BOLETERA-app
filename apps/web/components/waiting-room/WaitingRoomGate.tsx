'use client';

import { useEffect, useRef, useState } from 'react';
import type { WaitingRoomState } from './useWaitingRoom';
import styles from './WaitingRoomGate.module.scss';

/**
 * Pantalla de sala de espera.
 *
 * Tiene que contestar tres preguntas antes de que el comprador se enfade:
 * ¿dónde estoy?, ¿cuánto falta? y —la que de verdad genera desconfianza—
 * ¿por qué el que llegó después puede ir delante de mí? Lo último NO es un
 * detalle de implementación que se pueda omitir: el orden se SORTEA al abrir,
 * y si la interfaz no lo dice, quien quede detrás asumirá que le hicimos trampa.
 */

/**
 * Cada cuánto puede hablar el lector de pantalla.
 *
 * La posición cambia cada pocos segundos; anunciarla cada vez convierte la
 * página en un martilleo inusable (WCAG 2.2 AA: `aria-live="polite"` no exime
 * de ser razonable con la frecuencia). Medio minuto informa sin secuestrar.
 */
const ANNOUNCE_INTERVAL_MS = 30_000;

const numberFormat = new Intl.NumberFormat('es-MX');

function formatWait(seconds: number): string {
  if (seconds <= 0) return 'Es tu turno';
  if (seconds < 60) return 'Menos de un minuto';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} hora${hours === 1 ? '' : 's'}`;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function WaitingRoomGate({
  room,
  eventTitle,
}: {
  room: WaitingRoomState;
  eventTitle?: string;
}) {
  const { phase, status, opensAt, notice, connectionIssue, paused } = room;
  const opensAtMs = opensAt ? new Date(opensAt).getTime() : null;

  // Reloj local para la cuenta atrás: no cuesta ni una petición.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (opensAtMs === null || Date.now() >= opensAtMs) return;
    const id = setInterval(() => {
      const value = Date.now();
      setNow(value);
      if (value >= opensAtMs) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [opensAtMs]);

  const isBeforeOpen = opensAtMs !== null && now < opensAtMs;
  const total = status?.total ?? 0;
  const ahead = status?.ahead ?? 0;

  // Denominador congelado: la barra sólo debe avanzar. Si usáramos el total
  // vivo, cada persona que entra detrás haría retroceder la barra de todos.
  const initialAheadRef = useRef<number | null>(null);
  if (status && !isBeforeOpen && initialAheadRef.current === null && status.ahead > 0) {
    initialAheadRef.current = status.ahead;
  }
  const baseline = initialAheadRef.current;
  const progress = baseline && baseline > 0 ? Math.min(1, 1 - ahead / baseline) : 0;

  // --- anuncio para lectores de pantalla, con freno ---------------------------
  const [announcement, setAnnouncement] = useState('');
  const lastAnnouncedAtRef = useRef(0);
  useEffect(() => {
    if (phase !== 'queued' || !status) return;
    const elapsed = Date.now() - lastAnnouncedAtRef.current;
    if (elapsed < ANNOUNCE_INTERVAL_MS) return;
    lastAnnouncedAtRef.current = Date.now();

    if (opensAtMs !== null && Date.now() < opensAtMs) {
      const minutes = Math.max(1, Math.round((opensAtMs - Date.now()) / 60_000));
      setAnnouncement(
        `La venta abre en ${minutes} minuto${minutes === 1 ? '' : 's'}. ` +
          `${numberFormat.format(status.total)} personas esperando. ` +
          'El orden se sortea al abrir, no depende de quién llegó antes.',
      );
      return;
    }
    setAnnouncement(
      status.position === null
        ? 'Entrando a la fila.'
        : `Lugar ${numberFormat.format(status.position)} en la fila. ` +
            `${numberFormat.format(status.ahead)} personas por delante. ` +
            `Espera estimada: ${formatWait(status.estimatedWaitSeconds).toLowerCase()}.`,
    );
  }, [phase, status, opensAtMs]);

  if (phase === 'left') {
    return (
      <section className={styles.room} aria-labelledby="waiting-room-title">
        <p className={styles.eyebrow}>Sala de espera</p>
        <h2 className={styles.title} id="waiting-room-title">
          Saliste de la fila
        </h2>
        <p className={styles.lead}>
          Liberaste tu lugar. Puedes volver a entrar cuando quieras, pero si la venta ya abrió
          entrarás por el final, detrás de quienes siguen esperando.
        </p>
        <button type="button" className={styles.primaryAction} onClick={room.rejoin}>
          Volver a entrar a la fila
        </button>
      </section>
    );
  }

  return (
    <section className={styles.room} aria-labelledby="waiting-room-title">
      <p className={styles.eyebrow}>
        <span className={styles.pulse} aria-hidden="true" />
        Sala de espera
      </p>
      <h2 className={styles.title} id="waiting-room-title">
        {isBeforeOpen ? 'La venta aún no abre' : 'Estás en la fila'}
      </h2>
      {eventTitle && <p className={styles.lead}>{eventTitle}</p>}

      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      {isBeforeOpen ? (
        <>
          <div className={styles.countdown}>
            <span className={styles.countdownLabel}>Abre en</span>
            {/* El ticker es decorativo para el lector: el anuncio hablado va
                por la región `aria-live`, y en minutos, no en segundos. */}
            <strong className={styles.countdownValue} aria-hidden="true">
              {formatCountdown((opensAtMs ?? 0) - now)}
            </strong>
          </div>
          <div className={styles.fairness}>
            <h3>Llegar antes no da ventaja</h3>
            <p>
              Todos los que estamos aquí antes de la apertura entramos a una pre-fila. En el
              momento de abrir, el orden se <strong>sortea</strong>: no se reparte por orden de
              llegada. Quedarte en esta pantalla es suficiente, y recargar o volver a entrar{' '}
              <strong>no cambia tu lugar</strong> ni te penaliza.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className={styles.metrics}>
            <div className={styles.metricMain}>
              <span className={styles.metricLabel}>Tu lugar</span>
              <strong className={styles.metricValue}>
                {status?.position === null || status === null
                  ? '—'
                  : numberFormat.format(status.position)}
              </strong>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Personas delante</span>
              <strong className={styles.metricValue}>{numberFormat.format(ahead)}</strong>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Espera estimada</span>
              <strong className={styles.metricValue}>
                {formatWait(status?.estimatedWaitSeconds ?? 0)}
              </strong>
            </div>
          </div>

          <div className={styles.progressTrack} aria-hidden="true">
            <div className={styles.progressFill} style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>

          <p className={styles.lead}>
            La fila avanza sola: no hace falta recargar. {numberFormat.format(total)} personas en
            total. Si vuelves a entrar, conservas tu lugar.
          </p>
        </>
      )}

      {/* Una sola región hablada, alimentada con freno de 30 s. */}
      <p className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <div className={styles.footer}>
        <p className={styles.footNote}>
          {paused
            ? 'Pausamos la actualización porque esta pestaña no está a la vista. Vuelve a ella y seguimos al instante: tu lugar sigue guardado.'
            : connectionIssue === 'throttled'
              ? 'Estamos consultando más despacio para no saturar el servidor. Tu lugar en la fila no se ve afectado.'
              : connectionIssue === 'offline'
                ? 'Perdimos contacto con el servidor. Seguimos reintentando; tu lugar sigue guardado.'
                : 'Mantén esta pestaña abierta. Te avisamos aquí mismo en cuanto sea tu turno.'}
        </p>
        <button type="button" className={styles.secondaryAction} onClick={room.leave}>
          Salir de la fila
        </button>
      </div>
    </section>
  );
}
