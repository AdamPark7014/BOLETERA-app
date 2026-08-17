'use client';

import { useMemo, useState } from 'react';
import { cx } from '../lib/cx';
import { defaultValueFormat, type ValueFormatter } from '../lib/chart';
import { formatPercent } from '../lib/format';
import { funnelSegmentPath } from '../lib/path';
import { vizColor } from '../styles/tokens';
import { ChartShell, type ChartTooltipState } from '../internal/ChartShell';
import styles from './FunnelChart.module.scss';

/** Etapa del embudo. El orden del arreglo es el orden del recorrido. */
export interface FunnelStage {
  id: string;
  label: string;
  value: number;
  color?: string;
}

export interface FunnelChartProps {
  stages: readonly FunnelStage[];
  /** Descripcion para lectores de pantalla. Obligatoria. */
  label: string;
  /** Pie de figura visible. */
  caption?: string;
  /** Alto de cada etapa en px. Por defecto 46. */
  stageHeight?: number;
  /** Formato de valores en tooltip, etiquetas y tabla. */
  formatValue?: ValueFormatter;
  /**
   * Base del porcentaje mostrado en cada etapa: contra la primera etapa
   * (`total`) o contra la etapa inmediatamente anterior (`previous`).
   * Por defecto `previous`.
   */
  conversionBase?: 'total' | 'previous';
  className?: string;
}

/**
 * Embudo de conversion para el recorrido de compra: visitas, vista de mapa,
 * apartado, pago iniciado y pago confirmado.
 *
 * Cada etapa muestra su valor y su conversion; la caida respecto a la etapa
 * previa se resalta porque es la lectura accionable.
 *
 * @example
 * <FunnelChart label="Embudo de compra" stages={etapas} conversionBase="previous" />
 */
export function FunnelChart({
  stages,
  label,
  caption,
  stageHeight = 46,
  formatValue = defaultValueFormat,
  conversionBase = 'previous',
  className,
}: FunnelChartProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null);

  const usable = useMemo(
    () => stages.filter((stage) => Number.isFinite(stage.value)),
    [stages],
  );
  const top = usable[0]?.value ?? 0;

  const table = useMemo(
    () => ({
      columns: ['Etapa', 'Valor', 'Conversion vs. anterior', 'Conversion total'],
      rows: usable.map((stage, index) => {
        const previous = usable[index - 1]?.value ?? stage.value;
        return [
          stage.label,
          formatValue(stage.value),
          previous > 0 ? formatPercent(stage.value / previous) : '—',
          top > 0 ? formatPercent(stage.value / top) : '—',
        ];
      }),
    }),
    [usable, top, formatValue],
  );

  const height = Math.max(1, usable.length) * stageHeight;

  return (
    <ChartShell
      label={label}
      caption={caption}
      height={height}
      table={table}
      tooltip={tooltip}
      className={className}
    >
      {({ width }) => {
        const labelWidth = Math.min(180, Math.max(96, width * 0.28));
        const chartLeft = labelWidth;
        const chartWidth = Math.max(24, width - labelWidth);
        const centerX = chartLeft + chartWidth / 2;

        const widthAt = (value: number): number =>
          top > 0 ? Math.max(6, (value / top) * chartWidth) : 6;

        return (
          <svg width={width} height={height} role="presentation">
            {usable.map((stage, index) => {
              const next = usable[index + 1];
              const previous = usable[index - 1];
              const y0 = index * stageHeight + 3;
              const y1 = (index + 1) * stageHeight - 3;
              const color = stage.color ?? vizColor(index);
              const base = conversionBase === 'total' ? top : (previous?.value ?? stage.value);
              const conversion = base > 0 ? stage.value / base : 0;
              const isDimmed = hovered !== null && hovered !== stage.id;

              return (
                <g
                  key={stage.id}
                  className={cx(styles.stage, isDimmed && styles.dimmed)}
                  onMouseEnter={() => {
                    setHovered(stage.id);
                    setTooltip({
                      x: centerX,
                      y: y0,
                      title: stage.label,
                      rows: [
                        { label: 'Valor', value: formatValue(stage.value), color },
                        {
                          label: conversionBase === 'total' ? 'Del total' : 'De la etapa previa',
                          value: formatPercent(conversion),
                        },
                      ],
                    });
                  }}
                  onMouseLeave={() => {
                    setHovered(null);
                    setTooltip(null);
                  }}
                >
                  <path
                    d={funnelSegmentPath(
                      centerX,
                      y0,
                      y1,
                      widthAt(stage.value),
                      widthAt(next?.value ?? stage.value),
                    )}
                    fill={color}
                    className={styles.segment}
                  />
                  <text className={styles.stageLabel} x={labelWidth - 12} y={(y0 + y1) / 2} textAnchor="end">
                    {stage.label}
                  </text>
                  <text className={styles.stageValue} x={centerX} y={(y0 + y1) / 2} textAnchor="middle">
                    {formatValue(stage.value)}
                  </text>
                  {index > 0 ? (
                    <text
                      className={styles.conversion}
                      x={width - 4}
                      y={(y0 + y1) / 2}
                      textAnchor="end"
                    >
                      {formatPercent(conversion, 0)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        );
      }}
    </ChartShell>
  );
}
