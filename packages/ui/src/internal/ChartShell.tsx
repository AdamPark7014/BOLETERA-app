'use client';

import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { useElementSize } from '../lib/hooks';
import styles from './ChartShell.module.scss';

/** Fila del tooltip: una serie con su valor y su color. */
export interface ChartTooltipRow {
  label: string;
  value: string;
  color?: string;
}

/** Estado del tooltip flotante de un chart, en coordenadas del contenedor. */
export interface ChartTooltipState {
  x: number;
  y: number;
  title: string;
  rows: readonly ChartTooltipRow[];
}

/** Tabla equivalente al chart, expuesta solo a tecnologias de asistencia. */
export interface ChartDataTable {
  columns: readonly string[];
  rows: readonly (readonly (string | number)[])[];
}

export interface ChartShellProps {
  /** Descripcion del grafico anunciada como `aria-label` del `role="img"`. */
  label: string;
  /** Pie de figura visible. */
  caption?: ReactNode;
  /** Altura del area de dibujo en px. */
  height: number;
  /** Datos en forma tabular para lectores de pantalla. */
  table: ChartDataTable;
  /** Tooltip activo, o `null` si el puntero no esta sobre un dato. */
  tooltip?: ChartTooltipState | null;
  /** Leyenda opcional bajo el grafico. */
  legend?: ReactNode;
  className?: string;
  /** Contenido SVG. Recibe el tamano ya medido del contenedor. */
  children: (size: { width: number; height: number }) => ReactNode;
}

/**
 * Envoltorio comun de todos los charts: mide el contenedor para hacerlos
 * responsivos, aplica la semantica accesible (`role="img"` mas tabla oculta con
 * los datos) y posiciona el tooltip.
 *
 * Es interno al paquete; los charts publicos lo consumen, los consumidores no.
 */
export function ChartShell({
  label,
  caption,
  height,
  table,
  tooltip,
  legend,
  className,
  children,
}: ChartShellProps) {
  const [ref, size] = useElementSize<HTMLDivElement>({ width: 0, height });

  return (
    <figure className={cx(styles.shell, className)}>
      <div
        ref={ref}
        className={styles.canvas}
        style={{ height }}
        role="img"
        aria-label={label}
      >
        {size.width > 0 ? children({ width: size.width, height }) : null}

        {tooltip ? (
          <div
            className={styles.tooltip}
            style={{ left: tooltip.x, top: tooltip.y }}
            aria-hidden="true"
          >
            <p className={styles.tooltipTitle}>{tooltip.title}</p>
            {tooltip.rows.map((row) => (
              <p key={row.label} className={styles.tooltipRow}>
                {row.color ? (
                  <span className={styles.swatch} style={{ background: row.color }} />
                ) : null}
                <span className={styles.tooltipLabel}>{row.label}</span>
                <span className={styles.tooltipValue}>{row.value}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {legend}

      {caption ? <figcaption className={styles.caption}>{caption}</figcaption> : null}

      <table className={styles.srOnly}>
        <caption>{label}</caption>
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th key={cellIndex} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={cellIndex}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Leyenda compartida por los charts multiserie. */
export function ChartLegend({
  items,
}: {
  items: readonly { id: string; name: string; color: string }[];
}) {
  if (items.length <= 1) return null;
  return (
    <ul className={styles.legend} aria-hidden="true">
      {items.map((item) => (
        <li key={item.id} className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: item.color }} />
          {item.name}
        </li>
      ))}
    </ul>
  );
}
