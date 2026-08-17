'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Skeleton } from './Skeleton';
import { Sparkline } from './Sparkline';
import { TrendPill } from './TrendPill';
import styles from './KpiCard.module.scss';

export type KpiTone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface KpiCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Nombre de la metrica. */
  label: string;
  /** Valor principal, ya formateado por quien lo consume. */
  value: ReactNode;
  /** Unidad o sufijo discreto junto al valor ("MXN", "boletos"). */
  unit?: string;
  /**
   * Variacion relativa contra el periodo anterior. `0.082` = +8.2 %.
   * Omitela cuando no haya periodo comparable.
   */
  delta?: number;
  /** Texto del comparativo, p. ej. "vs. semana anterior". */
  deltaLabel?: string;
  /** Invierte el color del delta para metricas donde subir es malo. */
  invertDelta?: boolean;
  /** Serie historica para la sparkline embebida. */
  trend?: readonly number[];
  /** Icono decorativo en la esquina. */
  icon?: ReactNode;
  /** Color del icono y del acento. Por defecto `neutral`. */
  tone?: KpiTone;
  /** Sustituye el contenido por esqueletos y expone `aria-busy`. */
  loading?: boolean;
  /** Linea de contexto bajo el valor. */
  hint?: string;
  /** Convierte la tarjeta en un enlace a la vista de detalle. */
  href?: string;
}

/**
 * Tarjeta de indicador: valor, variacion contra el periodo anterior, sparkline
 * y estado de carga. Es la unidad basica de los dashboards del panel.
 *
 * @example
 * <KpiCard
 *   label="Ingreso bruto"
 *   value={formatCurrency(1284500)}
 *   delta={0.124}
 *   deltaLabel="vs. semana anterior"
 *   trend={[820, 910, 1040, 990, 1180, 1240, 1284]}
 * />
 */
export function KpiCard({
  label,
  value,
  unit,
  delta,
  deltaLabel = 'vs. periodo anterior',
  invertDelta = false,
  trend,
  icon,
  tone = 'neutral',
  loading = false,
  hint,
  href,
  className,
  ...rest
}: KpiCardProps) {
  const body = loading ? (
    <>
      <div className={styles.head}>
        <Skeleton shape="text" width="46%" height={11} />
      </div>
      <Skeleton shape="text" width="62%" height={26} delay={70} />
      <Skeleton shape="text" width="38%" height={11} delay={140} />
    </>
  ) : (
    <>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        {icon ? (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>

      <div className={styles.valueRow}>
        <span className={styles.value}>{value}</span>
        {unit ? <span className={styles.unit}>{unit}</span> : null}
      </div>

      <div className={styles.footer}>
        {delta === undefined ? (
          hint ? <span className={styles.hint}>{hint}</span> : null
        ) : (
          <TrendPill value={delta} invertColors={invertDelta} comparison={deltaLabel} />
        )}
        {trend && trend.length > 1 ? (
          <Sparkline
            className={styles.spark}
            data={trend}
            width={82}
            height={26}
            label={`Tendencia de ${label}`}
          />
        ) : null}
      </div>

      {delta !== undefined && hint ? <span className={styles.hint}>{hint}</span> : null}
    </>
  );

  const classes = cx(styles.card, styles[tone], href && styles.linked, className);

  if (href && !loading) {
    return (
      <a className={classes} href={href} aria-label={`${label}. Ver detalle`} {...rest}>
        {body}
      </a>
    );
  }

  return (
    <div className={classes} aria-busy={loading || undefined} {...rest}>
      {body}
    </div>
  );
}
