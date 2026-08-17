'use client';

import { CartesianChart } from '../internal/CartesianChart';
import type { CartesianChartProps } from '../lib/chart';

export interface LineChartProps extends CartesianChartProps {
  /** Suaviza la curva con interpolacion monotona (nunca sobrepasa los datos). */
  smooth?: boolean;
  /** Dibuja un punto en cada dato, util con series cortas. */
  showDots?: boolean;
}

/**
 * Grafico de lineas multiserie en SVG puro, con rejilla, ejes, tooltip de
 * indice cruzado y tabla equivalente para lectores de pantalla.
 *
 * @example
 * <LineChart
 *   label="Boletos vendidos por dia"
 *   series={[{ id: 'web', name: 'Web', data: [{ label: 'Lun', value: 320 }] }]}
 * />
 */
export function LineChart({ smooth = true, showDots = false, ...rest }: LineChartProps) {
  return <CartesianChart mode="line" smooth={smooth} showDots={showDots} {...rest} />;
}
