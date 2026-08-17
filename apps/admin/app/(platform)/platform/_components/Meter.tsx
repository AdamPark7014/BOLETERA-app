import { cx, formatPercent } from '@boletera/ui';
import styles from '../platform.module.scss';

export type MeterTone = 'accent' | 'success' | 'warning';

export interface MeterProps {
  /** Descripción accesible de lo que se está midiendo. */
  label: string;
  value: number;
  max: number;
  /** Proporción ya validada por `ratioOf`: solo se dibuja si existe base real. */
  ratio: number;
  tone?: MeterTone;
}

const TONE_CLASS: Readonly<Record<MeterTone, string>> = {
  accent: styles.meterAccent,
  success: styles.meterSuccess,
  warning: styles.meterWarning,
};

/** Barra de progreso para relaciones con numerador y denominador reales. */
export function Meter({ label, value, max, ratio, tone = 'accent' }: MeterProps) {
  return (
    <div
      className={cx(styles.meter, TONE_CLASS[tone])}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} de ${max} · ${formatPercent(ratio, 0)}`}
    >
      <span className={styles.meterFill} style={{ inlineSize: `${ratio * 100}%` }} />
    </div>
  );
}
