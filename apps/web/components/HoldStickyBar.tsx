'use client';

import { HoldCountdown } from './HoldCountdown';
import styles from './HoldStickyBar.module.scss';

/**
 * Temporizador de apartado fijo (mapa y pago): aviso a 2 min y salida clara al vencer.
 */
export function HoldStickyBar({
  expiresAt,
  onExpire,
  onWarn,
  warnSeconds = 120,
  className,
}: {
  expiresAt: string | null | undefined;
  onExpire?: () => void;
  onWarn?: () => void;
  warnSeconds?: number;
  className?: string;
}) {
  if (!expiresAt) return null;

  return (
    <div
      className={`${styles.bar} ${className ?? ''}`.trim()}
      role="region"
      aria-label="Tiempo de apartado"
    >
      <HoldCountdown
        expiresAt={expiresAt}
        warnSeconds={warnSeconds}
        onExpire={onExpire}
        onWarn={onWarn}
        label="Apartado"
        hint="Completa tu compra antes de que se liberen los lugares"
        expiredHint="El apartado venció. Vuelve al mapa y elige de nuevo."
      />
    </div>
  );
}
