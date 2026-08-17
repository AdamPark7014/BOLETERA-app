import { createHmac, timingSafeEqual } from 'node:crypto';

export type BanorteParsedStatus =
  | 'completed'
  | 'failed'
  | 'pending'
  | 'declined'
  | 'cancelled'
  | 'expired';

/**
 * Verify Banorte IPN / webhook HMAC signature.
 *
 * Soft-allow missing secret ONLY outside production (local demos).
 * In production (NODE_ENV=production), a missing secret ALWAYS fails —
 * never skip signature verification in production.
 *
 * Uses crypto.timingSafeEqual on equal-length buffers (timing-safe).
 */
export function verifyBanorteWebhookSignature(
  body: string,
  signature: string | undefined,
  secret: string,
): boolean {
  const isProd = process.env.NODE_ENV === 'production';
  if (!secret) {
    // Soft-allow only in demo/dev. Production MUST set BANORTE_WEBHOOK_SECRET.
    return !isProd;
  }
  if (!signature) return false;

  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const provided = signature.trim().toLowerCase();
  const expectedNorm = expected.toLowerCase();

  const expectedBuf = Buffer.from(expectedNorm, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/** Quita acentos y signos para comparar por token, no por subcadena. */
function normalizeToken(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Palabras que NIEGAN el veredicto que las sigue ("no aprobada", "sin exito"). */
const NEGATIONS = new Set(['no', 'sin', 'not', 'un']);

/**
 * Busca un token exacto, comprobando que no venga negado por la palabra previa.
 *
 * Éste es el corazón del arreglo: la comparación por subcadena daba
 * `"transaccion no aprobada".includes("aprobada") === true`, así que un cobro
 * RECHAZADO se conciliaba como completado y el sistema emitía boletos sin haber
 * cobrado. Comparar por token y mirar la palabra anterior evita justo eso.
 */
function hasAffirmativeToken(normalized: string, token: string): boolean {
  const words = normalized.split(' ');
  const target = normalizeToken(token);
  for (let i = 0; i < words.length; i++) {
    if (words[i] !== target) continue;
    if (i > 0 && NEGATIONS.has(words[i - 1])) return false;
    return true;
  }
  return false;
}

/**
 * Normaliza la respuesta del gateway a un veredicto.
 *
 * REGLA DE ORO: ante la duda, `pending`. Nunca `completed`. Un `pending` de más
 * retrasa una emisión y se resuelve en la siguiente pasada del reconciliador;
 * un `completed` de más regala un boleto y no hay cobro que reversar.
 *
 * Se evalúa primero lo negativo: si la respuesta menciona rechazo, no puede
 * ganar una coincidencia positiva que aparezca más adelante en el mismo texto.
 */
export function parseBanorteStatusText(text: string): BanorteParsedStatus {
  const normalized = normalizeToken(text);

  // El código de respuesta explícito manda sobre cualquier texto libre.
  // `normalized` ya colapsó separadores a espacios, así que se busca sobre esa
  // forma ("codigo respuesta 00"), no sobre el original con guiones bajos.
  const code = /\b(?:codigo respuesta|response code|cod resp)\s+([0-9]{1,3})\b/.exec(normalized);
  if (code) return Number(code[1]) === 0 ? 'completed' : 'declined';

  if (['rechazada', 'rechazado', 'declined', 'denegada', 'denegado', 'failed'].some((t) =>
    hasAffirmativeToken(normalized, t),
  )) {
    return 'declined';
  }
  if (['expirada', 'expirado', 'expired', 'timeout'].some((t) => hasAffirmativeToken(normalized, t))) {
    return 'expired';
  }
  if (['cancelada', 'cancelado', 'cancelled', 'canceled'].some((t) =>
    hasAffirmativeToken(normalized, t),
  )) {
    return 'cancelled';
  }
  if (['aprobada', 'aprobado', 'approved', 'exitosa', 'exitoso'].some((t) =>
    hasAffirmativeToken(normalized, t),
  )) {
    return 'completed';
  }
  return 'pending';
}

/**
 * Importe y moneda realmente liquidados por el gateway.
 *
 * Sin esto no existe ningún punto del sistema donde se compare lo cobrado con
 * lo debido: el `Payment` se guardaba con el total ESPERADO de la orden, así que
 * un descuadre de liquidación era indetectable por construcción.
 */
export function parseBanorteSettlement(
  body: Record<string, unknown>,
): { amount?: number; currency?: string } {
  const rawAmount = body.IMPORTE ?? body.importe ?? body.amount ?? body.monto;
  const amount = rawAmount === undefined ? undefined : Number(rawAmount);

  const rawCurrency = body.MONEDA ?? body.moneda ?? body.currency;
  const currency =
    rawCurrency === undefined
      ? undefined
      : String(rawCurrency) === '484'
        ? 'MXN'
        : String(rawCurrency) === '840'
          ? 'USD'
          : String(rawCurrency).toUpperCase();

  return {
    amount: Number.isFinite(amount) ? amount : undefined,
    currency,
  };
}


/**
 * Comparación de cadenas en tiempo constante.
 *
 * La usa el API para el secreto interno del reconciliador: comparar con `===`
 * filtra por tiempo cuántos caracteres iniciales acertó quien lo intenta.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Se compara igual contra sí mismo para no revelar la longitud por tiempo.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
