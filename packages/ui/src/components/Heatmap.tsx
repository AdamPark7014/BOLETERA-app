'use client';

import { useMemo, useState } from 'react';
import { cx } from '../lib/cx';
import { defaultValueFormat, type ValueFormatter } from '../lib/chart';
import { mixHex } from '../lib/color';
import { extent } from '../lib/scale';
import { palette } from '../styles/tokens';
import { ChartShell, type ChartTooltipState } from '../internal/ChartShell';
import styles from './Heatmap.module.scss';

export interface HeatmapProps {
  /** Etiquetas de fila, de arriba abajo. */
  rows: readonly string[];
  /** Etiquetas de columna, de izquierda a derecha. */
  columns: readonly string[];
  /**
   * Matriz `values[fila][columna]`. Las celdas faltantes o no finitas se
   * dibujan como huecos, no como ceros.
   */
  values: readonly (readonly number[])[];
  /** Descripcion para lectores de pantalla. Obligatoria. */
  label: string;
  /** Pie de figura visible. */
  caption?: string;
  /** Alto de cada celda en px. Por defecto 26. */
  cellHeight?: number;
  /** Color del extremo alto de la escala. Por defecto el acento de marca. */
  scaleTo?: string;
  /** Color del extremo bajo de la escala. */
  scaleFrom?: string;
  /** Formato de valores en tooltip y tabla. */
  formatValue?: ValueFormatter;
  /** Ancho reservado para las etiquetas de fila, en px. Por defecto 76. */
  rowLabelWidth?: number;
  className?: string;
}

/**
 * Matriz de intensidad para cruzar dos dimensiones: aforo por zona y funcion,
 * ventas por dia y hora, o incidencias por sede y semana.
 *
 * La escala de color se acompana siempre de la leyenda con los extremos, y los
 * valores exactos viven en la tabla accesible.
 *
 * @example
 * <Heatmap label="Ocupacion por zona y funcion" rows={zonas} columns={funciones} values={matriz} />
 */
export function Heatmap({
  rows,
  columns,
  values,
  label,
  caption,
  cellHeight = 26,
  scaleTo = palette.accent600,
  scaleFrom = palette.accent50,
  formatValue = defaultValueFormat,
  rowLabelWidth = 76,
  className,
}: HeatmapProps) {
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const domain = useMemo(() => extent(values.flat()), [values]);

  const table = useMemo(
    () => ({
      columns: ['', ...columns],
      rows: rows.map((rowLabel, rowIndex) => [
        rowLabel,
        ...columns.map((_unused, columnIndex) => {
          const value = values[rowIndex]?.[columnIndex];
          return value === undefined || !Number.isFinite(value) ? '—' : formatValue(value);
        }),
      ]),
    }),
    [rows, columns, values, formatValue],
  );

  const topAxis = 20;
  const height = topAxis + rows.length * cellHeight;
  const [min, max] = domain;
  const span = max - min;

  return (
    <ChartShell
      label={label}
      caption={caption}
      height={height}
      table={table}
      tooltip={tooltip}
      className={className}
      legend={
        <div className={styles.scale} aria-hidden="true">
          <span>{formatValue(min)}</span>
          <span
            className={styles.gradient}
            style={{ backgroundImage: `linear-gradient(90deg, ${scaleFrom}, ${scaleTo})` }}
          />
          <span>{formatValue(max)}</span>
        </div>
      }
    >
      {({ width }) => {
        const gridWidth = Math.max(1, width - rowLabelWidth);
        const cellWidth = gridWidth / Math.max(1, columns.length);

        return (
          <svg width={width} height={height} role="presentation">
            {columns.map((columnLabel, columnIndex) => (
              <text
                key={`col-${columnLabel}-${columnIndex}`}
                className={styles.axisLabel}
                x={rowLabelWidth + columnIndex * cellWidth + cellWidth / 2}
                y={topAxis / 2}
                textAnchor="middle"
              >
                {columnLabel}
              </text>
            ))}

            {rows.map((rowLabel, rowIndex) => (
              <g key={`row-${rowLabel}-${rowIndex}`}>
                <text
                  className={styles.rowLabel}
                  x={rowLabelWidth - 8}
                  y={topAxis + rowIndex * cellHeight + cellHeight / 2}
                  textAnchor="end"
                >
                  {rowLabel}
                </text>

                {columns.map((columnLabel, columnIndex) => {
                  const value = values[rowIndex]?.[columnIndex];
                  const key = `${rowIndex}:${columnIndex}`;
                  const missing = value === undefined || !Number.isFinite(value);
                  const intensity = missing || span === 0 ? 0 : ((value ?? 0) - min) / span;

                  return (
                    <rect
                      key={key}
                      className={cx(styles.cell, hovered === key && styles.hoveredCell)}
                      x={rowLabelWidth + columnIndex * cellWidth + 1}
                      y={topAxis + rowIndex * cellHeight + 1}
                      width={Math.max(1, cellWidth - 2)}
                      height={Math.max(1, cellHeight - 2)}
                      rx={3}
                      fill={missing ? 'transparent' : mixHex(scaleFrom, scaleTo, intensity)}
                      onMouseEnter={(event) => {
                        setHovered(key);
                        const bounds = event.currentTarget.getBBox();
                        setTooltip({
                          x: bounds.x + bounds.width / 2,
                          y: bounds.y,
                          title: `${rowLabel} · ${columnLabel}`,
                          rows: [
                            {
                              label: 'Valor',
                              value: missing ? 'Sin dato' : formatValue(value ?? 0),
                              color: missing ? undefined : mixHex(scaleFrom, scaleTo, intensity),
                            },
                          ],
                        });
                      }}
                      onMouseLeave={() => {
                        setHovered(null);
                        setTooltip(null);
                      }}
                    />
                  );
                })}
              </g>
            ))}
          </svg>
        );
      }}
    </ChartShell>
  );
}
