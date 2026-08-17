'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { defaultValueFormat, type ValueFormatter } from '../lib/chart';
import { formatPercent } from '../lib/format';
import { arcPath } from '../lib/path';
import { sum } from '../lib/scale';
import { vizColor } from '../styles/tokens';
import { ChartShell, type ChartTooltipState } from '../internal/ChartShell';
import styles from './DonutChart.module.scss';

/** Porcion del donut. */
export interface DonutSlice {
  id: string;
  label: string;
  value: number;
  /** Color explicito; si se omite se usa la serie categorica del tema. */
  color?: string;
}

export interface DonutChartProps {
  slices: readonly DonutSlice[];
  /** Descripcion para lectores de pantalla. Obligatoria. */
  label: string;
  /** Pie de figura visible. */
  caption?: string;
  /** Altura del lienzo en px. Por defecto 220. */
  height?: number;
  /** Grosor del anillo como fraccion del radio `(0, 1]`. Por defecto 0.34. */
  thickness?: number;
  /** Contenido del centro. Por defecto el total formateado. */
  center?: ReactNode;
  /** Etiqueta bajo el valor central. */
  centerLabel?: string;
  /** Formato de valores en tooltip, leyenda y tabla. */
  formatValue?: ValueFormatter;
  /** Oculta la leyenda lateral. */
  hideLegend?: boolean;
  className?: string;
}

const FULL_TURN = Math.PI * 2;
const GAP = 0.012;

/**
 * Grafico de dona para composiciones (mezcla de canales, tipos de boleto).
 * Muestra el total en el centro y una leyenda con valor y porcentaje, porque
 * un anillo por si solo no permite leer magnitudes.
 *
 * @example
 * <DonutChart label="Ventas por canal" slices={canales} centerLabel="Boletos" />
 */
export function DonutChart({
  slices,
  label,
  caption,
  height = 220,
  thickness = 0.34,
  center,
  centerLabel,
  formatValue = defaultValueFormat,
  hideLegend = false,
  className,
}: DonutChartProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null);

  const usable = useMemo(
    () => slices.filter((slice) => Number.isFinite(slice.value) && slice.value > 0),
    [slices],
  );
  const total = useMemo(() => sum(usable.map((slice) => slice.value)), [usable]);

  const table = useMemo(
    () => ({
      columns: ['Categoria', 'Valor', 'Participacion'],
      rows: usable.map((slice) => [
        slice.label,
        formatValue(slice.value),
        total > 0 ? formatPercent(slice.value / total) : '0 %',
      ]),
    }),
    [usable, total, formatValue],
  );

  return (
    <ChartShell
      label={label}
      caption={caption}
      height={height}
      table={table}
      tooltip={tooltip}
      className={cx(styles.donut, className)}
    >
      {({ width }) => {
        const chartWidth = hideLegend ? width : Math.min(width, height);
        const cx0 = chartWidth / 2;
        const cy0 = height / 2;
        const outer = Math.max(8, Math.min(chartWidth, height) / 2 - 4);
        const inner = outer * (1 - Math.min(0.95, Math.max(0.05, thickness)));

        let angle = 0;

        return (
          <div className={styles.layout}>
            <svg width={chartWidth} height={height} role="presentation">
              {total === 0 ? (
                <circle
                  className={styles.placeholder}
                  cx={cx0}
                  cy={cy0}
                  r={(outer + inner) / 2}
                  strokeWidth={outer - inner}
                />
              ) : (
                usable.map((slice, index) => {
                  const share = slice.value / total;
                  const start = angle;
                  const end = angle + share * FULL_TURN;
                  angle = end;
                  const color = slice.color ?? vizColor(index);
                  const isDimmed = hovered !== null && hovered !== slice.id;

                  return (
                    <path
                      key={slice.id}
                      className={cx(styles.slice, isDimmed && styles.dimmed)}
                      d={arcPath(cx0, cy0, outer, inner, start + GAP, Math.max(start + GAP, end - GAP))}
                      fill={color}
                      onMouseEnter={() => {
                        setHovered(slice.id);
                        setTooltip({
                          x: cx0,
                          y: cy0 - outer,
                          title: slice.label,
                          rows: [
                            { label: 'Valor', value: formatValue(slice.value), color },
                            { label: 'Participacion', value: formatPercent(share) },
                          ],
                        });
                      }}
                      onMouseLeave={() => {
                        setHovered(null);
                        setTooltip(null);
                      }}
                    />
                  );
                })
              )}

              <text className={styles.centerValue} x={cx0} y={centerLabel ? cy0 - 4 : cy0}>
                {center ?? formatValue(total)}
              </text>
              {centerLabel ? (
                <text className={styles.centerLabel} x={cx0} y={cy0 + 14}>
                  {centerLabel}
                </text>
              ) : null}
            </svg>

            {hideLegend ? null : (
              <ul className={styles.legend} aria-hidden="true">
                {usable.map((slice, index) => (
                  <li
                    key={slice.id}
                    className={cx(
                      styles.legendItem,
                      hovered !== null && hovered !== slice.id && styles.dimmed,
                    )}
                    onMouseEnter={() => setHovered(slice.id)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <span
                      className={styles.swatch}
                      style={{ background: slice.color ?? vizColor(index) }}
                    />
                    <span className={styles.legendLabel}>{slice.label}</span>
                    <span className={styles.legendValue}>
                      {total > 0 ? formatPercent(slice.value / total, 0) : '0 %'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      }}
    </ChartShell>
  );
}
