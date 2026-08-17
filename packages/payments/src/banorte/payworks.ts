import { createHmac, timingSafeEqual } from 'crypto';
import type { BanorteConfig } from './config';
import type { PaymentStatusResult } from '../types';

export type PayworksChargeParams = {
  orderId: string;
  publicId: string;
  amount: number;
  currency: string;
  buyerEmail: string;
  buyerName: string;
};

/** Parámetros típicos Payworks / 3-D Secure Banorte (ajusta con el manual de tu afiliación). */
export function buildPayworksRedirectUrl(cfg: BanorteConfig, params: PayworksChargeParams): string {
  const amount = params.amount.toFixed(2);
  const reference = params.publicId.replace(/[^A-Za-z0-9]/g, '').slice(0, 20);

  const query = new URLSearchParams({
    ID_AFILIACION: cfg.affiliation,
    ID_TERMINAL: cfg.terminal,
    USUARIO: cfg.user,
    REFERENCIA: reference,
    IMPORTE: amount,
    MONEDA: params.currency === 'USD' ? '840' : '484',
    CORREO: params.buyerEmail,
    NOMBRE: params.buyerName.slice(0, 60),
    URL_RESPUESTA: `${cfg.returnUrl.replace(/\/$/, '')}/orders/${params.publicId}/pago?result=ok`,
    URL_CANCELACION: `${cfg.cancelUrl.replace(/\/$/, '')}/orders/${params.publicId}/pago?result=cancel`,
    CMD_TRANS: 'VENTA',
    METODO_PAGO: 'TC',
  });

  if (cfg.password) {
    const sig = signPayworksPayload(query.toString(), cfg.password);
    query.set('FIRMA', sig);
  }

  const base = cfg.payworksUrl.includes('?') ? cfg.payworksUrl : `${cfg.payworksUrl}?`;
  return `${base}${query.toString()}`;
}

function signPayworksPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/** Comparación en tiempo constante; `timingSafeEqual` exige buffers del mismo tamaño. */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // La longitud sí se filtra (es inevitable), pero no el contenido.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifica la firma HMAC del IPN Banorte.
 *
 * Antes, sin `BANORTE_WEBHOOK_SECRET` cualquier POST anónimo a
 * /payments/webhooks/banorte se aceptaba fuera de producción, y la comparación
 * de firmas era `===` (vulnerable a ataque de tiempo) — F1-25. Ahora el
 * "soft-allow" exige además activarlo explícitamente con
 * BANORTE_ALLOW_UNSIGNED_WEBHOOK=true, para que ni en desarrollo sea el
 * comportamiento por defecto.
 */
export function verifyBanorteWebhookSignature(
  body: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!secret) {
    const isProd = process.env.NODE_ENV === 'production';
    const optIn = process.env.BANORTE_ALLOW_UNSIGNED_WEBHOOK === 'true';
    return !isProd && optIn;
  }
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const received = signature.trim();
  return (
    timingSafeEqualString(expected, received) ||
    timingSafeEqualString(expected, received.toLowerCase())
  );
}

/* ------------------------------------------------------------------------- *
 * Lectura de respuestas Banorte (consulta de transacción e IPN)
 *
 * F1-04: la versión anterior decidía por subcadenas sobre el cuerpo crudo y
 * comprobaba "aprobada" ANTES que "rechaz". «Transacción NO APROBADA» contiene
 * "aprobada", así que un pago rechazado se conciliaba como completado y se
 * emitían boletos gratis cada 30 s desde el worker. Aquí ya no se adivina:
 * se parsea la respuesta a pares clave/valor y se decide por un código de
 * respuesta explícito. Lo que no se reconozca con certeza es 'pending'.
 * ------------------------------------------------------------------------- */

/** Nombres de campo donde Payworks publica el código de respuesta. */
const RESPONSE_CODE_FIELDS = [
  'CODIGO_RESPUESTA',
  'CODIGORESPUESTA',
  'COD_RESPUESTA',
  'CODIGO_AUTORIZACION_RESPUESTA',
  'CODIGO',
  'RESPONSE_CODE',
  'RESPONSECODE',
  'RESPUESTA',
  'CODE',
] as const;

/** Campos con el estatus en texto (se comparan por token exacto, nunca por subcadena). */
const STATUS_TEXT_FIELDS = [
  'RESULTADO',
  'ESTATUS',
  'ESTADO',
  'STATUS',
  'RESPONSE',
  'TRANSACTION_STATUS',
] as const;

const AMOUNT_FIELDS = [
  'IMPORTE',
  'IMPORTE_TOTAL',
  'MONTO',
  'MONTO_TOTAL',
  'AMOUNT',
  'AMOUNT_PAID',
  'TOTAL',
] as const;

const CURRENCY_FIELDS = ['MONEDA', 'CURRENCY', 'DIVISA', 'CURRENCY_CODE'] as const;

const DEFAULT_APPROVED_CODES = ['00'];

/**
 * Catálogo ISO-8583 habitual de rechazos. No pretende ser exhaustivo: cualquier
 * código fuera de ambas listas se trata como 'pending' (nunca como cobrado),
 * y se registra para poder ampliarlas con el manual real de la afiliación.
 */
const DEFAULT_DECLINED_CODES = [
  '01', '02', '03', '04', '05', '06', '07', '08', '12', '13', '14', '15',
  '19', '21', '25', '30', '33', '34', '36', '38', '41', '43', '51', '54',
  '55', '57', '58', '59', '61', '62', '63', '65', '75', '76', '78', '82',
  '91', '92', '93', '96',
];

const APPROVED_TOKENS = new Set([
  'APROBADA', 'APROBADO', 'APPROVED', 'A', 'SUCCESS', 'EXITOSA', 'EXITOSO',
  'PAGADA', 'PAGADO', 'LIQUIDADA', 'LIQUIDADO', 'COMPLETED', 'COMPLETADA',
]);

const DECLINED_TOKENS = new Set([
  'RECHAZADA', 'RECHAZADO', 'DECLINED', 'DENEGADA', 'DENEGADO', 'FAILED',
  'FALLIDA', 'FALLIDO', 'CANCELADA', 'CANCELADO', 'CANCELLED', 'D', 'R', 'N',
]);

/** Los catálogos son configurables por env sin recompilar (CSV). */
function codeSetFromEnv(envVar: string, fallback: string[]): Set<string> {
  const raw = process.env[envVar];
  const list = raw
    ? raw.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)
    : fallback;
  return new Set(list);
}

export function getApprovedResponseCodes(): Set<string> {
  return codeSetFromEnv('BANORTE_APPROVED_CODES', DEFAULT_APPROVED_CODES);
}

export function getDeclinedResponseCodes(): Set<string> {
  return codeSetFromEnv('BANORTE_DECLINED_CODES', DEFAULT_DECLINED_CODES);
}

function normalizeToken(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .toUpperCase();
}

/** Aplana el objeto a un mapa CLAVE_MAYUSCULAS → valor escalar. */
function flattenFields(
  input: unknown,
  out: Record<string, string> = {},
  depth = 0,
): Record<string, string> {
  if (depth > 3 || input === null || typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') {
      flattenFields(value, out, depth + 1);
      continue;
    }
    // Las claves anidadas no pisan a las de nivel superior.
    const upper = key.toUpperCase();
    if (!(upper in out)) out[upper] = String(value);
  }
  return out;
}

/**
 * Convierte la respuesta cruda en pares clave/valor: JSON → form-urlencoded →
 * XML plano. Devuelve `null` si no se reconoce ningún formato (se tratará como
 * indeterminado, jamás como aprobado).
 */
export function parseBanorteResponse(text: string): Record<string, string> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed) as unknown;
      const fields = flattenFields(Array.isArray(json) ? { items: json } : json);
      return Object.keys(fields).length ? fields : null;
    } catch {
      /* sigue con los demás formatos */
    }
  }

  if (trimmed.startsWith('<')) {
    // XML sencillo <TAG>valor</TAG>; no se soportan atributos ni anidamiento.
    const fields: Record<string, string> = {};
    const tagRe = /<\s*([A-Za-z_][\w.-]*)\s*>([^<]*)<\s*\/\s*\1\s*>/g;
    for (const match of trimmed.matchAll(tagRe)) {
      const key = match[1].toUpperCase();
      if (!(key in fields)) fields[key] = match[2].trim();
    }
    return Object.keys(fields).length ? fields : null;
  }

  if (/^[^\s=&]+=[^\n]*/.test(trimmed) && trimmed.includes('=')) {
    const fields: Record<string, string> = {};
    for (const [key, value] of new URLSearchParams(trimmed.split(/\r?\n/)[0])) {
      const upper = key.toUpperCase();
      if (!(upper in fields)) fields[upper] = value;
    }
    return Object.keys(fields).length ? fields : null;
  }

  return null;
}

function firstField(
  fields: Record<string, string>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = fields[name];
    if (value !== undefined && String(value).trim() !== '') return String(value);
  }
  return undefined;
}

/**
 * Importe liquidado. Acepta `1234.56`, `1,234.56` y `1234,56`.
 * NO interpreta centavos sin punto decimal: si Payworks liquidara en centavos
 * enteros habría que confirmarlo con el manual de la afiliación antes de dividir.
 */
export function parseSettlementAmount(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  let text = String(raw).replace(/[^\d.,-]/g, '').trim();
  if (!text) return undefined;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma > lastDot) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else {
    text = text.replace(/,/g, '');
  }
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/** MONEDA numérica ISO-4217 → alfabética. */
export function parseSettlementCurrency(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const value = normalizeToken(raw);
  if (!value) return undefined;
  if (value === '484') return 'MXN';
  if (value === '840') return 'USD';
  if (/^[A-Z]{3}$/.test(value)) return value;
  return undefined;
}

export function extractSettlementAmount(
  fields: Record<string, string>,
): number | undefined {
  return parseSettlementAmount(firstField(fields, AMOUNT_FIELDS));
}

export function extractSettlementCurrency(
  fields: Record<string, string>,
): string | undefined {
  return parseSettlementCurrency(firstField(fields, CURRENCY_FIELDS));
}

/**
 * Decide el estado a partir de un código explícito. Sin código reconocido
 * devuelve 'pending': nunca se infiere aprobación de texto libre.
 */
export function classifyBanorteResponse(fields: Record<string, string>): {
  status: 'completed' | 'pending' | 'failed';
  rawCode?: string;
} {
  const approved = getApprovedResponseCodes();
  const declined = getDeclinedResponseCodes();

  const rawCodeField = firstField(fields, RESPONSE_CODE_FIELDS);
  if (rawCodeField !== undefined) {
    const code = normalizeToken(rawCodeField);
    if (approved.has(code)) return { status: 'completed', rawCode: code };
    if (declined.has(code)) return { status: 'failed', rawCode: code };
  }

  const rawStatusField = firstField(fields, STATUS_TEXT_FIELDS);
  if (rawStatusField !== undefined) {
    const token = normalizeToken(rawStatusField);
    // Igualdad exacta, no `includes`: "TRANSACCION NO APROBADA" no es "APROBADA".
    if (approved.has(token) || APPROVED_TOKENS.has(token)) {
      return { status: 'completed', rawCode: token };
    }
    if (declined.has(token) || DECLINED_TOKENS.has(token)) {
      return { status: 'failed', rawCode: token };
    }
  }

  return {
    status: 'pending',
    rawCode: normalizeToken(rawCodeField ?? rawStatusField) || undefined,
  };
}

function warnUnrecognized(reference: string, text: string): void {
  console.warn(
    `[banorte] Respuesta de consulta no reconocida para ${reference}; se trata como PENDIENTE. ` +
      `Primeros 200 caracteres: ${text.slice(0, 200).replace(/\s+/g, ' ')}`,
  );
}

/** Referencia SPEI única ligada a la orden (abono a cuenta Banorte). */
/** Consulta estado de transacción (ajusta URL según manual Payworks de tu afiliación). */
export async function queryBanorteTransactionStatus(
  cfg: BanorteConfig,
  reference: string,
): Promise<PaymentStatusResult> {
  if (cfg.isDemo || !cfg.user || !cfg.password) {
    return { status: 'pending' };
  }

  const queryUrl =
    process.env.BANORTE_QUERY_URL ??
    'https://eps.banorte.com/secure3d/consultaTransaccion.htm';

  try {
    const params = new URLSearchParams({
      ID_AFILIACION: cfg.affiliation,
      USUARIO: cfg.user,
      REFERENCIA: reference.replace(/[^A-Za-z0-9]/g, '').slice(0, 20),
    });
    if (cfg.password) {
      params.set('FIRMA', signPayworksPayload(params.toString(), cfg.password));
    }

    const res = await fetch(`${queryUrl}?${params.toString()}`, { method: 'GET' });
    const text = await res.text();

    if (!res.ok) {
      console.warn(
        `[banorte] Consulta ${reference} respondió HTTP ${res.status}; se trata como PENDIENTE. ` +
          `Primeros 200 caracteres: ${text.slice(0, 200).replace(/\s+/g, ' ')}`,
      );
      return { status: 'pending' };
    }

    const fields = parseBanorteResponse(text);
    if (!fields) {
      warnUnrecognized(reference, text);
      return { status: 'pending' };
    }

    const { status, rawCode } = classifyBanorteResponse(fields);
    if (status === 'pending') warnUnrecognized(reference, text);

    return {
      status,
      rawCode,
      amount: extractSettlementAmount(fields),
      currency: extractSettlementCurrency(fields),
    };
  } catch (error) {
    console.warn(`[banorte] Consulta ${reference} falló: ${String(error)}`);
    return { status: 'pending' };
  }
}

export function buildSpeiReference(publicId: string, accountClabe: string): {
  clabe: string;
  concept: string;
  reference: string;
} {
  const reference = publicId.replace(/[^A-Z0-9]/gi, '').slice(-12).toUpperCase();
  return {
    clabe: accountClabe,
    concept: `BOLETERA ${reference}`,
    reference,
  };
}
