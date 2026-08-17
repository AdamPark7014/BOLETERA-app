'use client';

import { useEffect, useRef, useState } from 'react';
import {
  describeRemaining,
  formatCountdown,
  formatDeadline,
  secondsUntil,
} from '@/lib/payment-window';
import styles from './HoldCountdown.module.scss';

/**
 * Contador honesto: siempre se recalcula contra el `expiresAt` que devolvió el
 * servidor, nunca contra un decremento local. La diferencia importa porque la
 * pestaña se suspende en segundo plano y `setInterval` se congela: un contador
 * decreciente marcaba «quedan 8 minutos» sobre un hold liberado hacía rato, y
 * el comprador descubría la verdad al pagar. Aquí, al volver del segundo plano,
 * el número salta a la realidad.
 *
 * Sirve para dos relojes distintos con la misma mecánica:
 *   · `variant="hold"`    — la reserva de butacas (minutos).
 *   · `variant="payment"` — la ventana de pago diferido OXXO/SPEI (horas).
 */

type Variant = 'hold' | 'payment';

const DEFAULTS: Record<Variant, { label: string; hint: string; expiredHint: string }> = {
  hold: {
    label: 'Asientos reservados',
    hint: 'Completa el pago antes de que expire',
    expiredHint: 'Vuelve al evento y selecciona de nuevo',
  },
  payment: {
    label: 'Tiempo para pagar',
    hint: 'Tus lugares están apartados hasta la fecha límite',
    expiredHint: 'La referencia venció. Vuelve a comprar para generar una nueva.',
  },
};

export function HoldCountdown({
  expiresAt,
  onExpire,
  onWarn,
  warnSeconds = 120,
  variant = 'hold',
  label,
  hint,
  expiredHint,
  showDeadline = false,
  onRenew,
  renewLabel = 'Renovar reserva',
  renewing = false,
}: {
  expiresAt: string | null | undefined;
  onExpire?: () => void;
  /** Se dispara una vez al cruzar `warnSeconds`, para avisar antes de expirar. */
  onWarn?: () => void;
  warnSeconds?: number;
  variant?: Variant;
  label?: string;
  hint?: string;
  expiredHint?: string;
  /** Añade la hora límite absoluta; imprescindible en ventanas de horas. */
  showDeadline?: boolean;
  /** Si el flujo permite renovar el hold, el botón aparece al entrar en aviso. */
  onRenew?: () => void;
  renewLabel?: string;
  renewing?: boolean;
}) {
  const [left, setLeft] = useState(() => secondsUntil(expiresAt));

  // Los callbacks suelen ser flechas en línea: guardarlos en refs evita
  // reiniciar el intervalo en cada render del padre.
  const onExpireRef = useRef(onExpire);
  const onWarnRef = useRef(onWarn);
  onExpireRef.current = onExpire;
  onWarnRef.current = onWarn;

  useEffect(() => {
    if (!expiresAt) {
      setLeft(0);
      return;
    }
    // Cada aviso se emite una sola vez por `expiresAt`; si no, `onExpire` se
    // dispararía una vez por segundo mientras el contador siga en cero.
    let warned = false;
    let expired = false;

    const tick = () => {
      const remaining = secondsUntil(expiresAt);
      setLeft(remaining);
      if (!warned && remaining > 0 && remaining <= warnSeconds) {
        warned = true;
        onWarnRef.current?.();
      }
      if (!expired && remaining === 0) {
        expired = true;
        onExpireRef.current?.();
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    // Al volver a la pestaña el intervalo puede llevar minutos congelado.
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [expiresAt, warnSeconds]);

  if (!expiresAt) return null;

  const copy = DEFAULTS[variant];
  const isExpired = left === 0;
  const isUrgent = left > 0 && left <= warnSeconds;
  const deadline = showDeadline ? formatDeadline(expiresAt) : null;

  // El número cambia cada segundo: anunciarlo en vivo satura al lector de
  // pantalla. Solo se anuncian los hitos (aviso y expiración).
  const announcement = isExpired
    ? `${copy.label}: tiempo agotado. ${expiredHint ?? copy.expiredHint}`
    : isUrgent
      ? `Quedan ${describeRemaining(left)} para completar tu compra.`
      : '';

  return (
    <div
      className={`${styles.wrap} ${isUrgent ? styles.urgent : ''} ${isExpired ? styles.expired : ''}`}
    >
      <span className={styles.label}>{isExpired ? 'Tiempo agotado' : (label ?? copy.label)}</span>
      <strong
        className={styles.time}
        role="timer"
        // `aria-live="off"`: el valor no se anuncia solo cada segundo. Al
        // navegar hasta él, `aria-label` da el contexto que «05:32» no tiene.
        aria-live="off"
        aria-label={
          isExpired
            ? `${label ?? copy.label}: tiempo agotado`
            : `${label ?? copy.label}: ${describeRemaining(left)}`
        }
      >
        {formatCountdown(left)}
      </strong>
      <span className={styles.hint}>
        {isExpired ? (expiredHint ?? copy.expiredHint) : (hint ?? copy.hint)}
        {deadline && !isExpired ? ` · Fecha límite: ${deadline}` : ''}
      </span>
      {onRenew && (isUrgent || isExpired) && (
        <button type="button" className={styles.renew} onClick={onRenew} disabled={renewing}>
          {renewing ? 'Renovando…' : renewLabel}
        </button>
      )}
      <p className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
