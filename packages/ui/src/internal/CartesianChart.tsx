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
import { areaPath, linePath } from '../lib/path';
import { bandScale, extent, linearScale, niceDomain, ticks, type Point } from '../lib/scale';
import { ChartLegend, ChartShell, type ChartTooltipState } from './ChartShell';
import styles from './CartesianChart.module.scss';

export interface CartesianChartInternalProps extends CartesianChartProps {
  /** `area` rellena bajo la curva; `line` solo traza el contorno. */
  mode: 'line' | 'area';
  /** Suaviza la curva con interpolacion monotona. */
  smooth?: boolean;
  /** Apila las series una sobre otra (solo tiene sentido en modo `area`). */
  stacked?: boolean;
  /** Dibuja un punto en cada dato, no solo en el que esta bajo el cursor. */
  showDots?: boolean;
}

/**
 * Motor compartido de {@link LineChart} y {@link AreaChart}. Calcula escalas,
 * rejilla, rutas y el tooltip de indice cruzado.
 */
export function CartesianChart({
  mode,
  series,
  label,
  caption,
  height = 220,
  formatValue = defaultValueFormat,
  formatAxis = defaultAxisFormat,
  tickCount = 4,
  startAtZero = true,
  hideGrid = false,
  hideXAxis = false,
  hideYAxis = false,
  smooth = false,
  stacked = false,
  showDots = false,
  className,
}: CartesianChartInternalProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  const labels = useMemo(() => categoryLabels(series), [series]);
  const colors = useMemo(() => series.map((item, index) => seriesColor(item, index)), [series]);

  // En modo apilado cada serie se dibuja sobre la suma de las anteriores.
  const stackedValues = useMemo(() => {
    if (!stacked) return series.map((item) => item.data.map((datum) => datum.value));
    const running = new Array<number>(labels.length).fill(0);
    return series.map((item) =>
      labels.map((_unused, index) => {
        running[index] = (running[index] ?? 0) + (item.data[index]?.value ?? 0);
        return running[index] ?? 0;
      }),
    );
  }, [series, labels, stacked]);

  const domain = useMemo(() => {
    const all = stackedValues.flat();
    const [min, max] = extent(all);
    return niceDomain([startAtZero ? Math.min(0, min) : min, max], tickCount);
  }, [stackedValues, startAtZero, tickCount]);

  const table = useMemo(() => seriesToTable(series, formatValue), [series, formatValue]);

  const [tooltipState, setTooltipState] = useState<ChartTooltipState | null>(null);

  const margin = {
    ...DEFAULT_MARGIN,
    left: hideYAxis ? 8 : DEFAULT_MARGIN.left,
    bottom: hideXAxis ? 8 : DEFAULT_MARGIN.bottom,
  };

  const handleLeave = useCallback(() => {
    setHovered(null);
    setTooltipState(null);
  }, []);

  return (
    <ChartShell
      label={label}
      caption={caption}
      height={height}
      table={table}
      tooltip={tooltipState}
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

        const band = bandScale(Math.max(1, labels.length), [margin.left, margin.left + innerWidth], 0);
        const y = linearScale(domain, [baseline, margin.top]);
        const gridValues = hideGrid && hideYAxis ? [] : ticks(domain, tickCount);
        const shownLabels = visibleLabelIndices(labels.length, Math.max(2, Math.floor(width / 78)));

        const seriesPoints: Point[][] = stackedValues.map((values) =>
          values.map((value, index) => ({ x: band.center(index), y: y(value) })),
        );

        const onMove = (event: MouseEvent<SVGRectElement>): void => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const offsetX = event.clientX - bounds.left + margin.left;
          const index = band.indexAt(offsetX);
          if (index === hovered) return;
          setHovered(index);
          setTooltipState({
            x: band.center(index),
            y: Math.min(...seriesPoints.map((points) => points[index]?.y ?? baseline)),
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

            {hideXAxis
              ? null
              : labels.map((text, index) =>
                  shownLabels.has(index) ? (
                    <text
                      key={`${text}-${index}`}
                      className={styles.axisLabel}
                      x={band.center(index)}
                      y={baseline + 16}
                      textAnchor="middle"
                    >
                      {text}
                    </text>
                  ) : null,
                )}

            {/* Las areas se pintan en orden inverso para que la serie 0 quede encima. */}
            {mode === 'area'
              ? seriesPoints
                  .map((points, index) => (
                    <path
                      key={`area-${series[index]?.id ?? index}`}
                      className={stacked ? styles.areaStacked : styles.area}
                      d={areaPath(points, baseline, smooth)}
                      fill={colors[index]}
                    />
                  ))
                  .reverse()
              : null}

            {seriesPoints.map((points, index) => (
              <path
                key={`line-${series[index]?.id ?? index}`}
                className={styles.line}
                d={linePath(points, smooth)}
                stroke={colors[index]}
              />
            ))}

            {showDots
              ? seriesPoints.flatMap((points, index) =>
                  points.map((point, pointIndex) => (
                    <circle
                      key={`dot-${index}-${pointIndex}`}
                      className={styles.dot}
                      cx={point.x}
                      cy={point.y}
                      r={2.5}
                      fill={colors[index]}
                    />
                  )),
                )
              : null}

            {hovered !== null ? (
              <g>
                <line
                  className={styles.crosshair}
                  x1={band.center(hovered)}
                  x2={band.center(hovered)}
                  y1={margin.top}
                  y2={baseline}
                />
                {seriesPoints.map((points, index) => {
                  const point = points[hovered];
                  if (!point) return null;
                  return (
                    <circle
                      key={`hover-${index}`}
                      className={styles.hoverDot}
                      cx={point.x}
                      cy={point.y}
                      r={4}
                      fill={colors[index]}
                    />
                  );
                })}
              </g>
            ) : null}

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
