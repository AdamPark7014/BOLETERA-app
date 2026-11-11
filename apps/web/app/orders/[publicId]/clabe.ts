/**
 * Validación de CLABE en el navegador, solo para avisar antes de enviar.
 *
 * Mismo algoritmo oficial de Banxico que el API (`apps/api/src/modules/orders/clabe.ts`):
 * pesos 3, 7, 1 sobre los 17 primeros dígitos, se suma (dígito × peso) mod 10
 * y el control es (10 − suma mod 10) mod 10. El servidor vuelve a validarla y
 * es quien manda.
 */

const WEIGHTS = [3, 7, 1] as const;

export function normalizeClabe(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}

export function clabeControlDigit(first17: string): number | null {
  if (!/^\d{17}$/.test(first17)) return null;
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += (Number(first17[i]) * WEIGHTS[i % 3]) % 10;
  return (10 - (sum % 10)) % 10;
}

/** Mensaje de error en español, o null si la CLABE es válida. */
export function clabeError(raw: string): string | null {
  const clabe = normalizeClabe(raw);
  if (!clabe) return 'Escribe tu CLABE interbancaria.';
  if (!/^\d+$/.test(clabe)) return 'La CLABE lleva solo números.';
  if (clabe.length !== 18) return `La CLABE tiene 18 dígitos; llevas ${clabe.length}.`;
  if (clabeControlDigit(clabe.slice(0, 17)) !== Number(clabe[17])) {
    return 'El dígito verificador no coincide. Revisa la CLABE en tu app bancaria.';
  }
  return null;
}

/** Agrupa 3-3-11-1 para leerla: banco, plaza, cuenta, control. */
export function groupClabe(raw: string): string {
  const d = normalizeClabe(raw);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 17), d.slice(17, 18)].filter(Boolean).join(' ');
}
