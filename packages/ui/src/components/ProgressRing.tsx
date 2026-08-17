import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { clamp } from '../lib/scale';
import { formatPercent } from '../lib/format';
import styles from './ProgressRing.module.scss';

export type ProgressRingTone = 'accent' | 'success' | 'warning' | 'danger' | 'info';

export interface ProgressRingProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Progreso actual, en las mismas unidades que `max`. */
  value: number;
  /** Valor que representa el 100 %. Por defecto 100. */
  max?: number;
  /** Diametro exterior en pixeles. Por defecto 72. */
  size?: number;
  /** Grosor del trazo en pixeles. Por defecto 7. */
  thickness?: number;
  /** Color del arco. Por defecto `accent`. */
  tone?: ProgressRingTone;
  /** Contenido central. Por defecto el porcentaje formateado. */
  children?: ReactNode;
  /** Descripcion accesible del indicador. */
  label: string;
  /** Oculta el texto central y deja solo el anillo. */
  hideValue?: boolean;
}

/**
 * Indicador circular de progreso determinado (aforo vendido, avance de un
 * corte, cumplimiento de meta). Expone `role="progressbar"` con los valores
 * `aria-*` correspondientes.
 */
export function ProgressRing({
  value,
  max = 100,
  size = 72,
  thickness = 7,
  tone = 'accent',
  label,
  hideValue = false,
  className,
  children,
  ...rest
}: ProgressRingProps) {
  const safeMax = max === 0 ? 1 : max;
  const ratio = clamp(value / safeMax, 0, 1);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      className={cx(styles.ring, styles[tone], className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={value}
      aria-valuetext={formatPercent(ratio, 0)}
      {...rest}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          className={styles.track}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={thickness}
        />
        <circle
          className={styles.value}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={thickness}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {hideValue ? null : (
        <span className={styles.center} aria-hidden="true">
          {children ?? formatPercent(ratio, 0)}
        </span>
      )}
    </div>
  );
}
