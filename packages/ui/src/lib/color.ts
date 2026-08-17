/** Interpolacion de color en sRGB para escalas continuas (heatmaps, mapas de calor de aforo). */

import { clamp } from './scale';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Convierte `#rgb` o `#rrggbb` a componentes. Devuelve negro si no parsea. */
export function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;
  const parsed = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(parsed)) return { r: 0, g: 0, b: 0 };
  return { r: (parsed >> 16) & 255, g: (parsed >> 8) & 255, b: parsed & 255 };
}

/** Convierte componentes a `#rrggbb`. */
export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (value: number): string =>
    Math.round(clamp(value, 0, 255))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * Mezcla dos colores hex.
 * @param t Posicion en `[0, 1]`: 0 devuelve `from`, 1 devuelve `to`.
 */
export function mixHex(from: string, to: string, t: number): string {
  const ratio = clamp(t, 0, 1);
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex({
    r: a.r + (b.r - a.r) * ratio,
    g: a.g + (b.g - a.g) * ratio,
    b: a.b + (b.b - a.b) * ratio,
  });
}

/**
 * Elige texto claro u oscuro segun la luminancia percibida del fondo, para que
 * las etiquetas sobre celdas de color mantengan contraste legible.
 */
export function readableTextOn(background: string): string {
  const { r, g, b } = hexToRgb(background);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#14171d' : '#ffffff';
}
