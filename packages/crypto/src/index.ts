import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Firma del QR rotativo de los boletos.
 *
 * Antes (v1) la firma era `HMAC(secretoGlobal, ticket:evento:ventana)`: una sola
 * clave para todos los boletos de todos los eventos. Filtrar esa clave —o
 * provisionarla en un escáner que alguien se lleva del recinto— permitía fabricar
 * el QR de cualquier boleto (F2-16). Ahora se deriva una clave por boleto y la
 * ventana temporal se firma con ella, así que el material criptográfico de un
 * boleto no sirve para falsificar otro.
 *
 * La comparación también era `===`, que corta en el primer byte distinto y filtra
 * la firma byte a byte ante un atacante con muchos intentos (F2-17). Ahora se usa
 * `timingSafeEqual`.
 */

/** Ventana de rotación del QR. Se acepta también la ventana anterior (30 s de gracia). */
const ROTATION_SECONDS = 15;
export const QR_ROTATION_SECONDS = ROTATION_SECONDS;

/**
 * La firma se trunca a 32 hex = 128 bits. Es suficiente: la ventana de validez
 * dura 30 s, así que un atacante tendría que acertar 2^128 en ese lapso, y cada
 * intento fallido queda registrado en `TicketScan`. Se documenta porque el
 * truncamiento es deliberado (el QR debe caber cómodamente en versión baja).
 */
const SIGNATURE_HEX_LENGTH = 32;

/** Versión del formato del payload del QR. Va en la clave corta `v`. */
export const QR_PAYLOAD_VERSION = 2;

/** Prefijo que marca una firma derivada por boleto, para distinguirla de las v1. */
const V2_PREFIX = 'v2.';

/**
 * Durante la transición se siguen aceptando firmas v1 (clave global), porque los
 * QR ya renderizados en la app del comprador se firmaron con ese formato y el
 * cliente móvil puede tardar en actualizarse. Poner en `false` —y desplegar—
 * cierra definitivamente el formato antiguo.
 */
const ACCEPT_LEGACY_V1_SIGNATURES = true;

export function generateTicketCode(): string {
  return `BLT-${randomBytes(8).toString('hex').toUpperCase()}`;
}

/** Ventana temporal actual del QR rotativo. */
function currentWindow(now = Date.now()): number {
  return Math.floor(now / (ROTATION_SECONDS * 1000));
}

/**
 * Clave por boleto: `HMAC(secretoMaestro, ticketId:eventId)`.
 *
 * Es un HMAC anidado (equivalente a la fase de extracción de HKDF con un `info`
 * fijo): barato de calcular en cada escaneo y suficiente para que comprometer el
 * material de un boleto no comprometa el resto.
 */
function deriveTicketKey(masterSecret: string, ticketId: string, eventId: string): Buffer {
  return createHmac('sha256', masterSecret).update(`${ticketId}:${eventId}`).digest();
}

/** Firma v2: la ventana temporal firmada con la clave derivada del boleto. */
function signWindowV2(
  masterSecret: string,
  ticketId: string,
  eventId: string,
  window: number,
): string {
  const key = deriveTicketKey(masterSecret, ticketId, eventId);
  return createHmac('sha256', key)
    .update(`v2:${ticketId}:${eventId}:${window}`)
    .digest('hex')
    .slice(0, SIGNATURE_HEX_LENGTH);
}

/** Firma v1 (heredada): clave global compartida. Solo se usa para verificar. */
function signWindowV1(
  masterSecret: string,
  ticketId: string,
  eventId: string,
  window: number,
): string {
  return createHmac('sha256', masterSecret)
    .update(`${ticketId}:${eventId}:${window}`)
    .digest('hex')
    .slice(0, SIGNATURE_HEX_LENGTH);
}

/**
 * Comparación en tiempo constante. `timingSafeEqual` exige búferes de la misma
 * longitud, así que la diferencia de longitud se resuelve aparte; se hace una
 * comparación de relleno para que ese caso no sea perceptiblemente más rápido.
 */
function timingSafeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Compara contra todos los candidatos sin cortocircuito: `||` en el lado derecho
 * garantiza que `timingSafeEquals` se evalúa siempre, de modo que el tiempo total
 * no revela con qué ventana coincidió la firma.
 */
function matchesAny(signature: string, candidates: string[]): boolean {
  let matched = false;
  for (const candidate of candidates) {
    matched = timingSafeEquals(signature, candidate) || matched;
  }
  return matched;
}

/**
 * Firma el boleto para la ventana temporal actual.
 *
 * Devuelve `v2.<32 hex>`. La firma pública no cambia (la llaman `orders`,
 * `notification` y `access` con el mismo secreto maestro de siempre).
 */
export function signTicketPayload(ticketId: string, eventId: string, secret: string): string {
  return `${V2_PREFIX}${signWindowV2(secret, ticketId, eventId, currentWindow())}`;
}

/**
 * Verifica la firma del QR. Acepta la ventana actual y la anterior.
 *
 * El formato se deduce de la propia firma: con prefijo `v2.` se verifica contra
 * la clave derivada; sin prefijo se trata como v1 (clave global) mientras dure la
 * transición. Nunca se prueban ambos formatos para la misma firma.
 */
export function verifyTicketSignature(
  ticketId: string,
  eventId: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature) return false;

  const window = currentWindow();
  const windows = [window, window - 1];

  if (signature.startsWith(V2_PREFIX)) {
    const raw = signature.slice(V2_PREFIX.length);
    return matchesAny(
      raw,
      windows.map((w) => signWindowV2(secret, ticketId, eventId, w)),
    );
  }

  if (!ACCEPT_LEGACY_V1_SIGNATURES) return false;

  return matchesAny(
    signature,
    windows.map((w) => signWindowV1(secret, ticketId, eventId, w)),
  );
}

/**
 * Payload del QR: JSON compacto con claves de una letra para que el código quepa
 * en una versión baja y se lea rápido con poca luz. `v` permite al escáner saber
 * qué formato tiene delante sin adivinar.
 */
export function buildQrPayload(ticketId: string, eventId: string, secret: string): string {
  const sig = signTicketPayload(ticketId, eventId, secret);
  return JSON.stringify({ v: QR_PAYLOAD_VERSION, t: ticketId, e: eventId, s: sig });
}

/**
 * Clave por boleto para que la APP MOVIL genere el QR rotativo SIN CONEXION.
 *
 * Es el mismo diseño que usa SafeTix: el telefono recibe la clave derivada de SU
 * boleto —nunca el secreto maestro— y calcula en local el codigo de cada ventana
 * de 15 s. Comprometer un telefono expone ESE boleto, no el sistema entero.
 *
 * Esto es lo que permite que el QR rotativo funcione en la puerta aunque no haya
 * cobertura, que es justo donde falla: un recinto lleno satura la red movil.
 *
 * ENTREGALA SOLO al dueño autenticado del boleto, y nunca la registres en logs.
 */
export function deriveTicketKeyHex(
  ticketId: string,
  eventId: string,
  secret: string,
): string {
  return deriveTicketKey(secret, ticketId, eventId).toString('hex');
}

/**
 * Huella corta y estable de un boleto para el manifiesto offline (F2-15).
 *
 * No rota con el tiempo: sirve para que el escáner detecte que su copia local fue
 * alterada, y liga el estado (`SOLD`/`USED`) al boleto, de modo que no se puede
 * "ascender" un boleto reembolsado editando el fichero del dispositivo.
 *
 * NO es material de verificación de firmas: con esta huella el escáner comprueba
 * pertenencia e integridad del manifiesto, no la firma rotativa del QR.
 */
export function ticketManifestDigest(
  ticketId: string,
  eventId: string,
  status: string,
  secret: string,
): string {
  const key = deriveTicketKey(secret, ticketId, eventId);
  return createHmac('sha256', key).update(`manifest:${status}`).digest('hex').slice(0, 12);
}

/**
 * Firma de una página del manifiesto, para que quien la reciba pueda comprobar
 * que la lista viene de la API y no de un proxy en la red del recinto.
 *
 * Se firma la página completa —id, estado y huella de cada entrada, más el
 * `issuedAt`— para que no se pueda reordenar, recortar ni reetiquetar entradas
 * sin invalidar la firma.
 */
export function signEventManifest(
  eventId: string,
  issuedAt: string,
  entries: { id: string; st: string; h: string }[],
  secret: string,
): string {
  const canonical = entries.map((e) => `${e.id}.${e.st}.${e.h}`).join(',');
  return createHmac('sha256', secret)
    .update(`manifest:v1:${eventId}:${issuedAt}:${entries.length}:${canonical}`)
    .digest('hex');
}
