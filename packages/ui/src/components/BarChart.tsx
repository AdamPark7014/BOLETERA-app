'use client';

import { useCallback, useMemo, useState, type MouseEvent } from 'react';
import {
  DEFAULT_MARGIN,
  categoryLabels,
  defaultAxisFormat,
  defaultValueFormat,
  seriesColor,
  seriesToTable,
  visibleLabelIndices,
  type CartesianChartProps,
} from '../lib/chart';
import { barPath } from '../lib/path';
import { bandScale, extent, linearScale, niceDomain, ticks } from '../lib/scale';
import { ChartLegend, ChartShell, type ChartTooltipState } from '../internal/ChartShell';
import styles from './BarChart.module.scss';

export interface BarChartProps extends CartesianChartProps {
  /**
   * `grouped` coloca las series lado a lado (comparar); `stacked` las apila
   * (componer un total).
   */
  layout?: 'grouped' | 'stacked';
  /** Radio de las esquinas superiores en px. Por defecto 3. */
  cornerRadius?: number;
}

/**
 * Grafico de barras multiserie en SVG puro, agrupado o apilado, con tooltip por
 * categoria y tabla equivalente para lectores de pantalla.
 *
 * @example
 * <BarChart label="Ingreso por zona" series={[{ id: 'mxn', name: 'Ingreso', data: zonas }]} />
 */
export function BarChart({
  series,
  label,
  caption,
  height = 240,
  formatValue = defaultValueFormat,
  formatAxis = defaultAxisFormat,
  tickCount = 4,
  startAtZero = true,
  hideGrid = false,
  hideXAxis = false,
  hideYAxis = false,
  layout = 'grouped',
  cornerRadius = 3,
  className,
}: BarChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null);

  const labels = useMemo(() => categoryLabels(series), [series]);
  const colors = useMemo(() => series.map((item, index) => seriesColor(item, index)), [series]);
  const table = useMemo(() => seriesToTable(series, formatValue), [series, formatValue]);

  const domain = useMemo(() => {
    const totals =
      layout === 'stacked'
        ? labels.map((_unused, index) =>
            series.reduce((total, item) => total + (item.data[index]?.value ?? 0), 0),
          )
        : series.flatMap((item) => item.data.map((datum) => datum.value));
    const [min, max] = extent(totals);
    return niceDomain([startAtZero ? Math.min(0, min) : min, max], tickCount);
  }, [series, labels, layout, startAtZero, tickCount]);

  const margin = {
    ...DEFAULT_MARGIN,
    left: hideYAxis ? 8 : DEFAULT_MARGIN.left,
    bottom: hideXAxis ? 8 : DEFAULT_MARGIN.bottom,
  };

  const handleLeave = useCallback(() => {
    setHovered(null);
    setTooltip(null);
  }, []);

  return (
    <ChartShell
      label={label}
      caption={caption}
      height={height}
      table={table}
      tooltip={tooltip}
      legend={
        <ChartLegend
          items={series.map((item, index) => ({
            id: item.id,
            name: item.name,
            color: colors[index] ?? '',
          }))}
        />
      }
      className={className}
    >
      {({ width }) => {
        const innerWidth = Math.max(1, width - margin.left - margin.right);
        const innerHeight = Math.max(1, height - margin.top - margin.bottom);
        const baseline = margin.top + innerHeight;

        const categories = bandScale(
          Math.max(1, labels.length),
          [margin.left, margin.left + innerWidth],
          0.26,
        );
        const groupWidth =
          layout === 'stacked'
            ? categories.bandwidth
            : categories.bandwidth / Math.max(1, series.length);
        const y = linearScale(domain, [baseline, margin.top]);
        const zero = y(Math.max(domain[0], 0));
        const gridValues = hideGrid && hideYAxis ? [] : ticks(domain, tickCount);
        const shownLabels = visibleLabelIndices(labels.length, Math.max(2, Math.floor(width / 78)));

        const onMove = (event: MouseEvent<SVGRectElement>): void => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const index = categories.indexAt(event.clientX - bounds.left + margin.left);
          if (index === hovered) return;
          setHovered(index);
          setTooltip({
            x: categories.center(index),
            y: margin.top,
            title: labels[index] ?? '',
            rows: series.map((item, seriesIndex) => ({
              label: item.name,
              value: formatValue(item.data[index]?.value ?? 0),
              color: colors[seriesIndex],
            })),
          });
        };

        return (
          <svg width={width} height={height} role="presentation">
            {gridValues.map((value) => (
              <g key={value}>
                {hideGrid ? null : (
                  <line
                    className={styles.grid}
                    x1={margin.left}
                    x2={margin.left + innerWidth}
                    y1={y(value)}
                    y2={y(value)}
                  />
                )}
                {hideYAxis ? null : (
                  <text className={styles.axisLabel} x={margin.left - 8} y={y(value)} textAnchor="end">
                    {formatAxis(value)}
                  </text>
                )}
              </g>
            ))}

            {labels.map((text, index) => {
              let stackTop = zero;
              return (
                <g key={`${text}-${index}`} opacity={hovered === null || hovered === index ? 1 : 0.45}>
                  {series.map((item, seriesIndex) => {
                    const value = item.data[index]?.value ?? 0;
                    const top = y(value);

                    if (layout === 'stacked') {
                      const barHeight = Math.abs(zero - top);
                      stackTop -= barHeight;
                      return (
                        <path
                          key={item.id}
                          className={styles.bar}
                          d={barPath(categories(index), stackTop, groupWidth, barHeight, cornerRadius)}
                          fill={colors[seriesIndex]}
                        />
                      );
                    }

                    return (
                      <path
                        key={item.id}
                        className={styles.bar}
                        d={barPath(
                          categories(index) + seriesIndex * groupWidth,
                          Math.min(top, zero),
                          Math.max(1, groupWidth - 2),
                          Math.abs(zero - top),
                          cornerRadius,
                        )}
                        fill={colors[seriesIndex]}
                      />
                    );
                  })}
                </g>
              );
            })}

            <line className={styles.axis} x1={margin.left} x2={margin.left + innerWidth} y1={zero} y2={zero} />

            {hideXAxis
              ? null
              : labels.map((text, index) =>
                  shownLabels.has(index) ? (
                    <text
                      key={`label-${text}-${index}`}
                      className={styles.axisLabel}
                      x={categories.center(index)}
                      y={baseline + 16}
                      textAnchor="middle"
                    >
                      {text}
                    </text>
                  ) : null,
                )}

            <rect
              className={styles.overlay}
              x={margin.left}
              y={margin.top}
              width={innerWidth}
              height={innerHeight}
              onMouseMove={onMove}
              onMouseLeave={handleLeave}
            />
          </svg>
        );
      }}
    </ChartShell>
  );
}
