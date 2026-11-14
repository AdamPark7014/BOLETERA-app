/**
 * Copia literal de los tokens Black Ticket (`packages/ui/src/styles/_variables.scss`, `$bt-*`) que la
 * escena 3D necesita como hex: los materiales de three.js no leen custom properties de CSS. Si cambia un
 * token en `@boletera/ui`, se actualiza aquí con el mismo valor. No agregues colores que no existan allá.
 */
export const BT = {
  ink: '#0B0B0C',
  inkSunken: '#080809',
  inkRaised: '#141416',
  inkOverlay: '#1C1C1F',
  line: '#2C2C2F',
  lineStrong: '#3A3A3E',
  text: '#F3F0E8',
  textSecondary: '#A39E94',
  textTertiary: '#8A857C',
  textDisabled: '#5C5954',
  gold: '#C6A56D',
  goldDeep: '#8E7344',
  moneyIn: '#8EAE96',
  moneyOut: '#C9847A',
  seatFree: '#17171A',
  seatSold: '#3A342C',
  seatSoldLine: '#6A6258',
  seatAccess: '#8EAFD0',
  bonePressed: '#E4E0D6',
} as const;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Baja el color de una zona (el que viene del mapa 2D) a un tono sobrio y legible sobre `--ink`:
 * conserva el matiz para que la zona se reconozca igual que en el 2D, pero recorta la saturación y
 * fija la luminosidad en una franja media. Colores no hex (p. ej. `rgb()`) se devuelven tal cual.
 */
export function toneZoneColor(input: string | undefined | null): string | undefined {
  // Franja media-baja: la butaca elegida (dorado con brillo) y la del cursor (hueso) resaltan sobre ella.
  return toneColor(input, 0.32, 0.42, 0.54);
}

/**
 * Igual que {@link toneZoneColor} pero para las escalas de calor (precio, vista): recorta la saturación y
 * conserva la luminosidad dentro de una franja amplia para que «malo» siga leyéndose más oscuro que «bueno».
 */
export function toneHeatColor(input: string | undefined | null): string | undefined {
  return toneColor(input, 0.42, 0.26, 0.64);
}

function toneColor(
  input: string | undefined | null,
  maxSat: number,
  minLight: number,
  maxLight: number
): string | undefined {
  if (!input) return input ?? undefined;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return input;
  let hex = m[1]!;
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s2 = Math.min(s, maxSat);
  const l2 = clamp(l, minLight, maxLight);
  const c = (1 - Math.abs(2 * l2 - 1)) * s2;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m2 = l2 - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return (
    '#' +
    rgb
      .map((v) =>
        Math.round((v + m2) * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
}
