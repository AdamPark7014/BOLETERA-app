/**
 * CLABE interbancaria (Banxico): 18 dígitos = banco (3) + plaza (3) +
 * cuenta (11) + dígito de control (1).
 *
 * El dígito de control se calcula con el algoritmo oficial de Banxico:
 * pesos 3, 7, 1 repetidos sobre los 17 primeros dígitos; se suma
 * (dígito × peso) mod 10 de cada posición y el control es
 * (10 − suma mod 10) mod 10.
 *
 * La web (`apps/web/app/orders/[publicId]/clabe.ts`) repite este mismo
 * algoritmo para avisar antes de enviar; el que manda es este.
 */

const CLABE_WEIGHTS = [3, 7, 1] as const;

/** Quita espacios y guiones que la gente copia de su app bancaria. */
export function normalizeClabe(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/[\s-]/g, '') : '';
}

/** Dígito de control de los 17 primeros dígitos. Null si la entrada no son 17 dígitos. */
export function clabeControlDigit(first17: string): number | null {
  if (!/^\d{17}$/.test(first17)) return null;
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    sum += (Number(first17[i]) * CLABE_WEIGHTS[i % 3]) % 10;
  }
  return (10 - (sum % 10)) % 10;
}

export type ClabeCheck =
  | { ok: true; clabe: string }
  | { ok: false; reason: 'format' | 'checksum'; message: string };

export function checkClabe(raw: unknown): ClabeCheck {
  const clabe = normalizeClabe(raw);
  if (!/^\d{18}$/.test(clabe)) {
    return {
      ok: false,
      reason: 'format',
      message: 'La CLABE tiene 18 dígitos, sin letras.',
    };
  }
  const expected = clabeControlDigit(clabe.slice(0, 17));
  if (expected === null || expected !== Number(clabe[17])) {
    return {
      ok: false,
      reason: 'checksum',
      message:
        'Esa CLABE no es válida: el dígito verificador no coincide. Revísala en tu app bancaria.',
    };
  }
  return { ok: true, clabe };
}

export function isValidClabe(raw: unknown): boolean {
  return checkClabe(raw).ok;
}

/** Solo los últimos 4 a la vista: así sale en respuestas, logs y pantallas sin permiso. */
export function maskClabe(clabe: string | null | undefined): string | null {
  if (!clabe) return null;
  const last4 = clabe.slice(-4);
  return `${'•'.repeat(Math.max(clabe.length - 4, 0))}${last4}`;
}

/**
 * Correo enmascarado: dos letras del usuario y la terminación del dominio.
 * `laura.vega@example.com` → `la•••@ex•••.com`.
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local.slice(0, Math.min(2, local.length))}•••@${host.slice(0, Math.min(2, host.length))}•••${tld}`;
}
