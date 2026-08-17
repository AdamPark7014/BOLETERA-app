/**
 * Devuelve la proporción solo cuando existen numerador y denominador reales.
 * Si la API no reporta una base contra la cual medir, regresa `null` y la
 * pantalla muestra el dato en crudo en vez de una barra inventada.
 */
export function ratioOf(value: number, max: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(max)) return null;
  if (max <= 0) return null;
  return Math.min(Math.max(value / max, 0), 1);
}
