'use client';

import { useId, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import type { ChartDatum } from '@boletera/ui';
import { EmptyState, Skeleton } from '@boletera/ui';
import styles from './dashboard.module.scss';

type RevenueChartProps = {
  current: readonly ChartDatum[];
  previous?: readonly ChartDatum[];
  /** Nombre de la serie principal: "Ingresos", "Órdenes", etc. */
  seriesName: string;
  previousLabel?: string;
  formatValue: (value: number) => string;
  formatAxis: (value: number) => string;
  loading?: boolean;
  emptyLabel?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
};

const HEIGHT = 240;
const PAD = { top: 18, right: 16, bottom: 30, left: 52 } as const;

type Coord = { x: number; y: number; value: number; label: string };

function buildSmoothPath(points: readonly Coord[], closed: boolean, baselineY: number): string {
  if (points.length === 0) return '';
  const first = points[0]!;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const cx = (prev.x + curr.x) / 2;
    d += ` C ${cx} ${prev.y}, ${cx} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  if (closed) {
    const last = points[points.length - 1]!;
    d += ` L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
  }
  return d;
}

function coordsFor(
  data: readonly ChartDatum[],
  plotW: number,
  plotH: number,
  min: number,
  span: number,
): Coord[] {
  const n = data.length;
  return data.map((datum, index) => ({
    x: PAD.left + (n === 1 ? plotW / 2 : (index / (n - 1)) * plotW),
    y: PAD.top + (1 - (datum.value - min) / span) * plotH,
    value: datum.value,
    label: datum.label,
  }));
}

/**
 * Serie de área con tooltip cruzado y serie de comparación opcional.
 * Autocontenida: no depende de las custom properties del design system,
 * porque el admin todavía no importa el tema global de `@boletera/ui`.
 */
export function RevenueChart({
  current,
  previous,
  seriesName,
  previousLabel = 'Periodo previo',
  formatValue,
  formatAxis,
  loading = false,
  emptyLabel = 'Sin datos en este periodo',
  emptyDescription,
  emptyAction,
}: RevenueChartProps) {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);

  const chart = useMemo(() => {
    if (current.length < 2) return null;

    const values = [
      ...current.map((d) => d.value),
      ...(previous ?? []).map((d) => d.value),
    ];
    const rawMin = Math.min(0, ...values);
    const rawMax = Math.max(...values, 0);
    const span = rawMax - rawMin || 1;
    const plotW = 720 - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const baselineY = HEIGHT - PAD.bottom;

    const currentCoords = coordsFor(current, plotW, plotH, rawMin, span);
    const previousCoords = previous?.length
      ? coordsFor(previous, plotW, plotH, rawMin, span)
      : null;

    const ticks = [0, 0.33, 0.66, 1].map((t) => {
      const value = rawMin + span * (1 - t);
      return { y: PAD.top + t * plotH, label: formatAxis(value) };
    });

    const labelEvery = Math.max(1, Math.ceil(current.length / 7));
    const xLabels = current
      .map((datum, index) => ({ datum, index }))
      .filter(({ index }) => index % labelEvery === 0 || index === current.length - 1)
      .map(({ datum, index }) => ({
        x: currentCoords[index]!.x,
        label: datum.label,
      }));

    return {
      width: 720,
      plotW,
      plotH,
      baselineY,
      currentCoords,
      previousCoords,
      ticks,
      xLabels,
      currentPath: buildSmoothPath(currentCoords, false, baselineY),
      areaPath: buildSmoothPath(currentCoords, true, baselineY),
      previousPath: previousCoords
        ? buildSmoothPath(previousCoords, false, baselineY)
        : null,
      last: currentCoords[currentCoords.length - 1],
    };
  }, [current, formatAxis, previous]);

  if (loading) {
    return (
      <div className={styles.chartSkeleton} role="status" aria-busy="true">
        <Skeleton height={14} width="28%" delay={0} />
        <Skeleton height={160} radius={12} delay={60} />
        <div className={styles.chartSkeletonFooter}>
          <Skeleton height={10} width="18%" delay={120} />
          <Skeleton height={10} width="22%" delay={160} />
          <Skeleton height={10} width="16%" delay={200} />
        </div>
        <span className={styles.srOnly}>Cargando serie temporal…</span>
      </div>
    );
  }

  if (!chart) {
    return (
      <EmptyState
        size="sm"
        tone="neutral"
        illustration="chart"
        title={emptyLabel}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  const active = hover !== null ? chart.currentCoords[hover] : null;
  const prevActive =
    hover !== null && chart.previousCoords ? chart.previousCoords[hover] : null;

  const onMove = (event: MouseEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left) / Math.max(1, bounds.width);
    const index = Math.min(
      chart.currentCoords.length - 1,
      Math.max(0, Math.round(ratio * (chart.currentCoords.length - 1))),
    );
    setHover(index);
  };

  return (
    <div className={styles.chartWrap}>
      <svg
        className={styles.chartSvg}
        viewBox={`0 0 ${chart.width} ${HEIGHT}`}
        role="img"
        aria-label={`${seriesName} en el periodo`}
      >
        <defs>
          <linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {chart.ticks.map((tick) => (
          <g key={tick.y}>
            <line
              className={styles.chartGrid}
              x1={PAD.left}
              x2={chart.width - PAD.right}
              y1={tick.y}
              y2={tick.y}
            />
            <text className={styles.chartTick} x={PAD.left - 8} y={tick.y + 3.5} textAnchor="end">
              {tick.label}
            </text>
          </g>
        ))}

        {chart.previousPath ? (
          <path className={styles.chartPrev} d={chart.previousPath} />
        ) : null}

        <path className={styles.chartArea} d={chart.areaPath} fill={`url(#area-${uid})`} />
        <path className={styles.chartLine} d={chart.currentPath} />

        {chart.last ? (
          <circle className={styles.chartPoint} cx={chart.last.x} cy={chart.last.y} r={3.5} />
        ) : null}

        {active ? (
          <g>
            <line
              className={styles.chartCrosshair}
              x1={active.x}
              x2={active.x}
              y1={PAD.top}
              y2={chart.baselineY}
            />
            <circle className={styles.chartPoint} cx={active.x} cy={active.y} r={4.5} />
            {prevActive ? (
              <circle className={styles.chartPrevPoint} cx={prevActive.x} cy={prevActive.y} r={3.5} />
            ) : null}
          </g>
        ) : null}

        {chart.xLabels.map((label) => (
          <text
            key={`${label.x}-${label.label}`}
            className={styles.chartTick}
            x={label.x}
            y={HEIGHT - 8}
            textAnchor="middle"
          >
            {label.label}
          </text>
        ))}

        <rect
          className={styles.chartHit}
          x={PAD.left}
          y={PAD.top}
          width={chart.plotW}
          height={chart.plotH}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>

      {active ? (
        <div
          className={styles.chartTooltip}
          style={{
            left: `${(active.x / chart.width) * 100}%`,
            top: `${(Math.min(active.y, prevActive?.y ?? active.y) / HEIGHT) * 100}%`,
          }}
          aria-hidden="true"
        >
          <p className={styles.chartTooltipTitle}>{active.label}</p>
          <p className={styles.chartTooltipRow}>
            <span className={styles.chartSwatchCurrent} />
            <span>{seriesName}</span>
            <strong>{formatValue(active.value)}</strong>
          </p>
          {prevActive ? (
            <p className={styles.chartTooltipRow}>
              <span className={styles.chartSwatchPrev} />
              <span>{previousLabel}</span>
              <strong>{formatValue(prevActive.value)}</strong>
            </p>
          ) : null}
        </div>
      ) : null}

      {(previous?.length ?? 0) > 1 ? (
        <ul className={styles.chartLegend} aria-hidden="true">
          <li>
            <span className={styles.chartSwatchCurrent} />
            {seriesName}
          </li>
          <li>
            <span className={styles.chartSwatchPrev} />
            {previousLabel}
          </li>
        </ul>
      ) : null}

      <table className={styles.srOnly}>
        <caption>{seriesName} en el periodo</caption>
        <thead>
          <tr>
            <th scope="col">Periodo</th>
            <th scope="col">{seriesName}</th>
            {(previous?.length ?? 0) > 0 ? <th scope="col">{previousLabel}</th> : null}
          </tr>
        </thead>
        <tbody>
          {current.map((datum, index) => (
            <tr key={`${datum.label}-${index}`}>
              <th scope="row">{datum.label}</th>
              <td>{formatValue(datum.value)}</td>
              {(previous?.length ?? 0) > 0 ? (
                <td>{formatValue(previous?.[index]?.value ?? 0)}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
