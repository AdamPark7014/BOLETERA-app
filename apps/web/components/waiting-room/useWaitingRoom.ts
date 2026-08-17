'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getGuestSessionId } from '@/lib/guest-session';
import {
  QueueError,
  clearStoredPass,
  fetchQueueStatus,
  fetchWaitingRoomConfig,
  joinQueue,
  leaveQueue,
  readStoredPass,
  storePass,
  type QueueStatus,
} from './queue-client';

/**
 * Máquina de estados de la sala de espera + sondeo con respeto al servidor.
 *
 * RITMO DE SONDEO. El servidor admite 120 consultas de estado por minuto y por
 * IP, o sea una cada 500 ms. Nadie debería acercarse a ese techo: detrás de una
 * misma IP (NAT corporativo, red móvil) hay decenas de compradores reales, y el
 * primero que la agota deja a los demás con 429. Por eso el intervalo se elige
 * según lo cerca que esté el turno, y el suelo son 3 s:
 *
 *   · pre-fila (antes de `opensAt`): 15 s. El orden no existe todavía —se
 *     sortea al abrir— así que no hay nada que refrescar salvo el total; la
 *     cuenta atrás la lleva el reloj del navegador, sin red.
 *   · turno lejano (> 2 min de espera): 10 s. Un minuto de desfase en una
 *     espera de veinte no se nota.
 *   · turno cerca (≤ 2 min): 5 s.
 *   · turno inminente (≤ 30 s): 3 s. Es el único tramo caro y dura menos de un
 *     minuto: 20 consultas/min dejan sitio a ~6 pestañas por IP.
 *
 * Ante un 429 se retrocede exponencialmente (respetando `Retry-After` si viene)
 * hasta 60 s, y el ciclo se PARA en cuanto la pestaña deja de verse: gastar la
 * cuota en segundo plano es quitársela a quien sí está esperando delante.
 */

const POLL_PREQUEUE_MS = 15_000;
const POLL_FAR_MS = 10_000;
const POLL_NEAR_MS = 5_000;
/** Suelo duro. Por debajo de esto el sondeo deja de ser respetuoso. */
const POLL_IMMINENT_MS = 3_000;
const BACKOFF_MAX_MS = 60_000;

export type WaitingRoomPhase =
  /** Preguntando si el evento tiene sala; aún no se sabe. */
  | 'checking'
  /** No hay sala (o no pudimos saberlo): la compra sigue su curso normal. */
  | 'disabled'
  /** En la fila —o en la pre-fila— esperando turno. */
  | 'queued'
  /** Con pase: puede apartar butacas. */
  | 'admitted'
  /** Salió por su propio pie. */
  | 'left';

export type QueueConnectionIssue = 'none' | 'throttled' | 'offline';

export type WaitingRoomState = {
  phase: WaitingRoomPhase;
  status: QueueStatus | null;
  opensAt: string | null;
  /** Pase vigente, o `null`. Para render; en peticiones usa `getPass()`. */
  pass: string | null;
  /** Lectura estable del pase, sin depender del ciclo de render. */
  getPass: () => string | undefined;
  /** Explicación cuando volvemos a la fila tras un rechazo del servidor. */
  notice: string | null;
  connectionIssue: QueueConnectionIssue;
  /** El sondeo está detenido porque la pestaña no se ve. */
  paused: boolean;
  /** El API rechazó el pase (403): devuelve al comprador a la fila. */
  onQueueRejected: () => void;
  /** Abandono explícito: libera el sitio para los de atrás. */
  leave: () => void;
  /** Volver a entrar tras salir. Después de la apertura, entra por el final. */
  rejoin: () => void;
  /** Compra asegurada: ya tenemos los holds, el sitio en la fila sobra. */
  releaseSpot: () => void;
};

function pollIntervalFor(status: QueueStatus): number {
  const isOpen = Date.now() >= new Date(status.opensAt).getTime();
  if (!isOpen) return POLL_PREQUEUE_MS;
  if (status.estimatedWaitSeconds <= 30) return POLL_IMMINENT_MS;
  if (status.estimatedWaitSeconds <= 120) return POLL_NEAR_MS;
  return POLL_FAR_MS;
}

export function useWaitingRoom(eventId: string): WaitingRoomState {
  const [phase, setPhase] = useState<WaitingRoomPhase>('checking');
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [opensAt, setOpensAt] = useState<string | null>(null);
  const [pass, setPass] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connectionIssue, setConnectionIssue] = useState<QueueConnectionIssue>('none');
  const [paused, setPaused] = useState(false);

  const memberIdRef = useRef<string>('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(0);
  /** ¿El servidor nos tiene apuntados ahora mismo? Si no, hay que entrar. */
  const inQueueRef = useRef(false);
  const admittedRef = useRef(false);
  const passRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  /** Indirección para romper el ciclo `schedule` ↔ `tick`. */
  const runTickRef = useRef<() => void>(() => {});

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(
    (delayMs: number) => {
      clearTimer();
      if (!aliveRef.current || admittedRef.current) return;
      // Pestaña oculta: no se reprograma nada. `visibilitychange` reanuda.
      if (typeof document !== 'undefined' && document.hidden) return;
      timerRef.current = setTimeout(() => runTickRef.current(), delayMs);
    },
    [clearTimer],
  );

  const memberId = useCallback(() => {
    // Una sola identidad por navegador: la misma que firma los holds. Dos
    // claves distintas partirían la fila en dos y el pase no casaría.
    if (!memberIdRef.current) memberIdRef.current = getGuestSessionId();
    return memberIdRef.current;
  }, []);

  const tick = useCallback(async () => {
    if (!aliveRef.current || admittedRef.current) return;
    try {
      const next = inQueueRef.current
        ? await fetchQueueStatus(eventId, memberId())
        : await joinQueue(eventId, memberId());
      if (!aliveRef.current) return;

      backoffRef.current = 0;
      setConnectionIssue('none');
      // `position: null` significa que el servidor ya no nos tiene (expiró el
      // TTL o salimos desde otra pestaña): el siguiente ciclo vuelve a entrar.
      inQueueRef.current = next.position !== null;
      setStatus(next);
      setOpensAt(next.opensAt);

      if (next.admitted && next.pass) {
        admittedRef.current = true;
        passRef.current = next.pass;
        storePass(eventId, next.pass);
        setPass(next.pass);
        setNotice(null);
        setPhase('admitted');
        // Con pase en mano, sondear más sería gasto puro: la admisión no se revoca.
        clearTimer();
        return;
      }

      setPhase('queued');
      schedule(pollIntervalFor(next));
    } catch (error) {
      if (!aliveRef.current) return;
      const queueError =
        error instanceof QueueError ? error : new QueueError(0, 'Error inesperado');

      if (queueError.status === 400 || queueError.status === 404) {
        // La sala se apagó (o el evento no existe): no hay nada que esperar.
        clearTimer();
        setPhase('disabled');
        return;
      }

      setPhase((current) => (current === 'checking' ? 'queued' : current));

      if (queueError.status === 429) {
        setConnectionIssue('throttled');
        const suggested = queueError.retryAfterSeconds
          ? queueError.retryAfterSeconds * 1000
          : Math.max(backoffRef.current * 2, POLL_NEAR_MS * 2);
        backoffRef.current = Math.min(suggested, BACKOFF_MAX_MS);
        schedule(backoffRef.current);
        return;
      }

      setConnectionIssue('offline');
      backoffRef.current = Math.min(
        Math.max(backoffRef.current * 2, POLL_FAR_MS),
        BACKOFF_MAX_MS,
      );
      schedule(backoffRef.current);
    }
  }, [clearTimer, eventId, memberId, schedule]);

  // Debe declararse ANTES del arranque: los efectos corren en orden y el ciclo
  // necesita la referencia ya puesta.
  useEffect(() => {
    runTickRef.current = () => void tick();
  }, [tick]);

  useEffect(() => {
    aliveRef.current = true;
    admittedRef.current = false;
    inQueueRef.current = false;
    backoffRef.current = 0;
    let cancelled = false;

    void (async () => {
      let config;
      try {
        config = await fetchWaitingRoomConfig(eventId);
      } catch {
        // FALLA ABIERTA. Si no podemos leer la configuración no bloqueamos la
        // compra: si el evento sí tenía sala, el 403 del hold traerá al
        // comprador aquí con una explicación. Peor sería dejar a todo el mundo
        // mirando una pantalla de espera por un fallo nuestro.
        if (!cancelled) setPhase('disabled');
        return;
      }
      if (cancelled) return;
      if (!config.enabled) {
        setPhase('disabled');
        return;
      }
      setOpensAt(config.opensAt);

      const stored = readStoredPass(eventId);
      if (stored) {
        // Ya pasamos la fila en una visita anterior. El servidor sigue siendo
        // la autoridad: si el pase no vale, el hold responderá 403 y volvemos.
        admittedRef.current = true;
        // Puede que sigamos ocupando sitio de aquella visita: conviene soltarlo
        // al comprar o al cerrar, aunque en esta carga no hayamos entrado.
        inQueueRef.current = true;
        passRef.current = stored;
        setPass(stored);
        setPhase('admitted');
        return;
      }
      void tick();
    })();

    return () => {
      cancelled = true;
      aliveRef.current = false;
      clearTimer();
    };
  }, [clearTimer, eventId, tick]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibilityChange = () => {
      if (document.hidden) {
        clearTimer();
        setPaused(true);
        return;
      }
      setPaused(false);
      if (!aliveRef.current || admittedRef.current) return;
      // Al volver, lectura inmediata: la fila avanzó mientras no mirábamos.
      schedule(0);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [clearTimer, schedule]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPageHide = () => {
      // Sólo se suelta el sitio si YA hay pase. El pase sobrevive en
      // `localStorage`, así que volver es gratis y los de atrás avanzan. Sin
      // pase, cerrar la pestaña sin querer mandaría al final de la fila: quien
      // reentra después de la apertura va en FIFO, detrás de toda la pre-fila.
      if (!admittedRef.current || !inQueueRef.current) return;
      inQueueRef.current = false;
      void leaveQueue(eventId, memberId(), { keepalive: true });
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [eventId, memberId]);

  const getPass = useCallback(() => passRef.current ?? undefined, []);

  const onQueueRejected = useCallback(() => {
    clearStoredPass(eventId);
    passRef.current = null;
    admittedRef.current = false;
    inQueueRef.current = false;
    setPass(null);
    setNotice(
      'Tu pase de la sala de espera ya no era válido, así que no pudimos apartar esos lugares. Te devolvimos a la fila: en cuanto sea tu turno podrás elegir otra vez.',
    );
    setPhase('queued');
    void tick();
  }, [eventId, tick]);

  const leave = useCallback(() => {
    clearTimer();
    admittedRef.current = false;
    inQueueRef.current = false;
    passRef.current = null;
    clearStoredPass(eventId);
    setPass(null);
    setStatus(null);
    setNotice(null);
    setPhase('left');
    void leaveQueue(eventId, memberId());
  }, [clearTimer, eventId, memberId]);

  const rejoin = useCallback(() => {
    setNotice(null);
    setPhase('queued');
    void tick();
  }, [tick]);

  const releaseSpot = useCallback(() => {
    // Los holds ya están hechos y el pase guardado: el sitio en la fila sólo
    // infla la espera de los demás.
    if (!inQueueRef.current) return;
    inQueueRef.current = false;
    void leaveQueue(eventId, memberId());
  }, [eventId, memberId]);

  return {
    phase,
    status,
    opensAt,
    pass,
    getPass,
    notice,
    connectionIssue,
    paused,
    onQueueRejected,
    leave,
    rejoin,
    releaseSpot,
  };
}
