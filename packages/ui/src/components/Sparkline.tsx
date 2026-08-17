import { useId } from 'react';
import { cx } from '../lib/cx';
import { defaultValueFormat, type ValueFormatter } from '../lib/chart';
import { linePath, areaPath } from '../lib/path';
import { bandScale, extent, linearScale, type Point } from '../lib/scale';
import styles from './Sparkline.module.scss';

export type SparklineTone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'auto';

export interface SparklineProps {
  /** Serie de valores en orden cronologico. */
  data: readonly number[];
  /** Descripcion para lectores de pantalla. Obligatoria. */
  label: string;
  /** Ancho del lienzo en px. Por defecto 96. */
  width?: number;
  /** Alto del lienzo en px. Por defecto 28. */
  height?: number;
  /**
   * Color de la linea. `auto` la tine de verde o rojo segun si el ultimo valor
   * supera al primero, que es lo util dentro de un KPI.
   */
  tone?: SparklineTone;
  /** Rellena el area bajo la curva. Por defecto `true`. */
  filled?: boolean;
  /** Marca el ultimo punto con un circulo. Por defecto `true`. */
  showLastPoint?: boolean;
  /** Suaviza la curva. Por defecto `true`. */
  smooth?: boolean;
  /** Formato de los valores en la tabla accesible. */
  formatValue?: ValueFormatter;
  className?: string;
}

/**
 * Microgratico sin ejes para incrustar en KPIs, celdas de tabla o listas.
 * Al ser tan pequeno no lleva tooltip: la lectura fina va en la tabla oculta.
 */
export function Sparkline({
  data,
  label,
  width = 96,
  height = 28,
  tone = 'auto',
  filled = true,
  showLastPoint = true,
  smooth = true,
  formatValue = defaultValueFormat,
  className,
}: SparklineProps) {
  // `useId` incluye caracteres que no son validos en una referencia `url(#...)`.
  const gradientId = `spark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const values = data.filter((value) => Number.isFinite(value));

  if (values.length < 2) {
    return <span className={cx(styles.sparkline, styles.empty, className)} aria-hidden="true" />;
  }

  const padding = 2;
  const domain = extent(values);
  const flat = domain[0] === domain[1];
  const y = linearScale(
    flat ? [domain[0] - 1, domain[1] + 1] : domain,
    [height - padding, padding],
  );
  const band = bandScale(values.length, [padding, width - padding], 0);
  const points: Point[] = values.map((value, index) => ({ x: band.center(index), y: y(value) }));

  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const resolvedTone = tone === 'auto' ? (last >= first ? 'success' : 'danger') : tone;
  const lastPoint = points[points.length - 1];

  return (
    <span className={cx(styles.sparkline, styles[resolvedTone], className)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {filled ? (
          <path
            className={styles.area}
            d={areaPath(points, height - padding, smooth)}
            fill={`url(#${gradientId})`}
          />
        ) : null}
        <path className={styles.line} d={linePath(points, smooth)} />
        {showLastPoint && lastPoint ? (
          <circle className={styles.point} cx={lastPoint.x} cy={lastPoint.y} r={2} />
        ) : null}
      </svg>
      <span className={styles.srOnly}>
        {values.map((value) => formatValue(value)).join(', ')}
      </span>
    </span>
  );
}
