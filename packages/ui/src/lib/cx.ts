/** Valores aceptados por {@link cx}. Los falsy se descartan. */
export type ClassValue = string | number | false | null | undefined;

/**
 * Une nombres de clase descartando valores falsy.
 * @example cx(styles.btn, isActive && styles.active, className)
 */
export function cx(...values: ClassValue[]): string {
  let out = '';
  for (const value of values) {
    if (!value && value !== 0) continue;
    out = out ? `${out} ${value}` : String(value);
  }
  return out;
}
