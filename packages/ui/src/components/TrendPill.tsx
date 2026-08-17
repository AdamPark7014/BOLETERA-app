import type { HTMLAttributes } from 'react';
import { cx } from '../lib/cx';
import { formatDelta } from '../lib/format';
import styles from './TrendPill.module.scss';

export interface TrendPillProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Variacion relativa respecto al periodo anterior. `0.082` = +8.2 %. */
  value: number;
  /**
   * Invierte el codigo de color: util para metricas donde subir es malo
   * (reembolsos, contracargos, tasa de fraude).
   */
  invertColors?: boolean;
  /** Sufijo contextual, p. ej. "vs. semana anterior". */
  comparison?: string;
  /** Texto mostrado cuando `value` no es un numero finito. */
  emptyLabel?: string;
  /** Densidad. Por defecto `sm`. */
  size?: 'sm' | 'md';
}

/** Pildora de tendencia con flecha, porcentaje con signo y color semantico. */
export function TrendPill({
  value,
  invertColors = false,
  comparison,
  emptyLabel = 'Sin datos',
  size = 'sm',
  className,
  ...rest
}: TrendPillProps) {
  if (!Number.isFinite(value)) {
    return (
      <span className={cx(styles.pill, styles.flat, styles[size], className)} {...rest}>
        {emptyLabel}
      </span>
    );
  }

  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const isGood = invertColors ? value < 0 : value > 0;
  const tone = direction === 'flat' ? styles.flat : isGood ? styles.positive : styles.negative;
  const readable = `${formatDelta(value)}${comparison ? ` ${comparison}` : ''}`;

  return (
    <span className={cx(styles.pill, tone, styles[size], className)} title={readable} {...rest}>
      <svg className={styles.arrow} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        {direction === 'flat' ? (
          <path d="M2 6h8" />
        ) : direction === 'up' ? (
          <path d="M6 9.5V2.5M6 2.5L2.75 5.75M6 2.5l3.25 3.25" />
        ) : (
          <path d="M6 2.5v7M6 9.5L2.75 6.25M6 9.5l3.25-3.25" />
        )}
      </svg>
      <span>{formatDelta(value)}</span>
      {comparison ? <span className={styles.comparison}>{comparison}</span> : null}
    </span>
  );
}
