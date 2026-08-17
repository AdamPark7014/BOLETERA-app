'use client';

import { CartesianChart } from '../internal/CartesianChart';
import type { CartesianChartProps } from '../lib/chart';

export interface AreaChartProps extends CartesianChartProps {
  /** Suaviza la curva con interpolacion monotona. Por defecto `true`. */
  smooth?: boolean;
  /**
   * Apila las series: cada una se dibuja sobre la suma de las anteriores.
   * Usalo para composiciones (ingreso por canal), no para comparaciones.
   */
  stacked?: boolean;
}

/**
 * Grafico de area, apilable. Comparte motor con {@link LineChart}, asi que
 * hereda su rejilla, tooltip y tabla accesible.
 *
 * @example
 * <AreaChart stacked label="Ingreso por canal" series={porCanal} />
 */
export function AreaChart({ smooth = true, stacked = false, ...rest }: AreaChartProps) {
  return <CartesianChart mode="area" smooth={smooth} stacked={stacked} {...rest} />;
}
