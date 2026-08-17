/** Tipos y utilidades compartidos por todos los charts del design system. */

import { formatCompact, formatNumber } from './format';
import { vizColor } from '../styles/tokens';

/** Un punto de una serie: etiqueta del eje categorico y valor numerico. */
export interface ChartDatum {
  /** Etiqueta del eje X (fecha ya formateada, canal, zona...). */
  label: string;
  value: number;
}

/** Serie de datos con identidad propia y color opcional. */
export interface ChartSeries {
  id: string;
  /** Nombre legible; aparece en la leyenda, el tooltip y la tabla accesible. */
  name: string;
  /** Color explicito. Si se omite se toma de la serie categorica del tema. */
  color?: string;
  data: readonly ChartDatum[];
}

/** Convierte un valor numerico en la cadena que se muestra al usuario. */
export type ValueFormatter = (value: number) => string;

/** Props comunes a los charts cartesianos. */
export interface CartesianChartProps {
  series: readonly ChartSeries[];
  /** Descripcion del grafico para lectores de pantalla. Obligatoria. */
  label: string;
  /** Pie de figura visible bajo el grafico. */
  caption?: string;
  /** Altura del area de dibujo en px. Por defecto 220. */
  height?: number;
  /** Formato de los valores en tooltip y tabla. Por defecto separadores es-MX. */
  formatValue?: ValueFormatter;
  /** Formato de las etiquetas del eje Y. Por defecto notacion compacta. */
  formatAxis?: ValueFormatter;
  /** Numero aproximado de lineas de rejilla horizontales. Por defecto 4. */
  tickCount?: number;
  /** Fuerza el origen del eje Y en cero. Por defecto `true`. */
  startAtZero?: boolean;
  /** Oculta la rejilla horizontal. */
  hideGrid?: boolean;
  /** Oculta las etiquetas del eje X. */
  hideXAxis?: boolean;
  /** Oculta las etiquetas del eje Y. */
  hideYAxis?: boolean;
  className?: string;
}

/** Margenes internos del area de dibujo, en px. */
export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_MARGIN: ChartMargin = { top: 12, right: 12, bottom: 24, left: 44 };

/** Formato por defecto de valores: entero con separadores es-MX. */
export const defaultValueFormat: ValueFormatter = (value) => formatNumber(value);

/** Formato por defecto de ejes: compacto para no encimar etiquetas. */
export const defaultAxisFormat: ValueFormatter = (value) => formatCompact(value);

/** Color de la serie `index`, respetando el color explicito si lo trae. */
export function seriesColor(series: ChartSeries, index: number): string {
  return series.color ?? vizColor(index);
}

/**
 * Etiquetas del eje X que caben sin encimarse: devuelve el conjunto de indices
 * a dibujar, muestreando de forma uniforme e incluyendo siempre el ultimo.
 */
export function visibleLabelIndices(count: number, maxLabels: number): Set<number> {
  const visible = new Set<number>();
  if (count <= 0) return visible;
  if (count <= maxLabels) {
    for (let i = 0; i < count; i += 1) visible.add(i);
    return visible;
  }
  const stride = Math.ceil(count / Math.max(1, maxLabels));
  for (let i = 0; i < count; i += stride) visible.add(i);
  visible.add(count - 1);
  return visible;
}

/**
 * Etiquetas del eje categorico. Se toman de la serie mas larga para que las
 * series incompletas no recorten el eje.
 */
export function categoryLabels(series: readonly ChartSeries[]): string[] {
  let longest: readonly ChartDatum[] = [];
  for (const item of series) {
    if (item.data.length > longest.length) longest = item.data;
  }
  return longest.map((datum) => datum.label);
}

/** Tabla accesible de un conjunto de series cartesianas. */
export function seriesToTable(
  series: readonly ChartSeries[],
  format: ValueFormatter,
): { columns: string[]; rows: (string | number)[][] } {
  const labels = categoryLabels(series);
  return {
    columns: ['Periodo', ...series.map((item) => item.name)],
    rows: labels.map((label, index) => [
      label,
      ...series.map((item) => {
        const datum = item.data[index];
        return datum ? format(datum.value) : '—';
      }),
    ]),
  };
}
