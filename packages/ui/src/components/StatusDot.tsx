import type { HTMLAttributes } from 'react';
import { cx } from '../lib/cx';
import styles from './StatusDot.module.scss';

export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export interface StatusDotProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Color semantico del estado. Por defecto `neutral`. */
  tone?: StatusTone;
  /** Halo animado para estados "en vivo" (venta abierta, escaneo activo). */
  pulse?: boolean;
  /** Tamano del punto. Por defecto `md`. */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Texto visible junto al punto. Sin el, el punto se marca como decorativo
   * para no comunicar estado unicamente por color.
   */
  label?: string;
}

/** Punto de estado, opcionalmente con etiqueta y pulso de actividad. */
export function StatusDot({
  tone = 'neutral',
  pulse = false,
  size = 'md',
  label,
  className,
  ...rest
}: StatusDotProps) {
  return (
    <span
      className={cx(styles.wrapper, className)}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      <span className={cx(styles.dot, styles[tone], styles[size], pulse && styles.pulse)} />
      {label ? <span className={styles.label}>{label}</span> : null}
    </span>
  );
}
