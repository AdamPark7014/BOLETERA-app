/**
 * Traducción de fallos HTTP a algo que el comprador pueda hacer.
 *
 * El endurecimiento del API (whitelist estricta, propiedad de holds, cuota de
 * peticiones) multiplicó los códigos que el checkout puede recibir. Un
 * `alert(body.message)` con «Invalid or expired holds» no le dice a nadie que
 * tiene que volver al mapa a reelegir asiento, así que cada código se traduce a
 * una frase y a una acción concreta.
 */

export type ApiErrorKind =
  | 'validation' // 400 — el cuerpo o los datos del formulario
  | 'credential' // 401/403 — falta credencial o el método no está permitido
  | 'conflict' // 409 (y el 400 de holds caducados) — el inventario cambió
  | 'rate-limit' // 429
  | 'server' // 5xx
  | 'network' // no hubo respuesta
  | 'unknown';

export type ApiErrorInfo = {
  status: number;
  kind: ApiErrorKind;
  /** Texto listo para mostrar, en español y accionable. */
  message: string;
  /** Mensaje crudo del API, para depurar; nunca es lo que se muestra solo. */
  raw?: string;
  /** Segundos que conviene esperar antes de reintentar (429). */
  retryAfterSeconds?: number;
  /** El intento requiere volver a reservar: los holds ya no valen. */
  needsNewHold?: boolean;
};

/** Señales de que el hold murió; el API las devuelve como 400, no como 409. */
const STALE_HOLD_PATTERNS = [
  /invalid or expired holds/i,
  /hold\/offer mismatch/i,
  /could not resolve offer/i,
  /holdids or items required/i,
  /reserva expir/i,
];

function joinMessage(message: unknown): string {
  if (Array.isArray(message)) return message.filter(Boolean).join('. ');
  if (typeof message === 'string') return message;
  return '';
}

function parseRetryAfter(res: Response): number | undefined {
  const header = res.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) {
    return Math.max(1, Math.ceil((asDate - Date.now()) / 1000));
  }
  return undefined;
}

export function formatWaitHint(seconds?: number): string {
  if (!seconds || seconds <= 0) return 'Espera un minuto e inténtalo de nuevo.';
  if (seconds < 60) return `Espera ${seconds} segundo${seconds === 1 ? '' : 's'} e inténtalo de nuevo.`;
  const minutes = Math.ceil(seconds / 60);
  return `Espera ${minutes} minuto${minutes === 1 ? '' : 's'} e inténtalo de nuevo.`;
}

/** Lee el cuerpo de una respuesta fallida y decide qué contarle al comprador. */
export async function readApiError(res: Response, fallback = 'No se pudo completar la operación'): Promise<ApiErrorInfo> {
  let raw = '';
  try {
    const body = (await res.json()) as { message?: unknown; error?: unknown };
    raw = joinMessage(body.message) || joinMessage(body.error);
  } catch {
    raw = '';
  }

  const staleHold = STALE_HOLD_PATTERNS.some((re) => re.test(raw));

  if (res.status === 409 || staleHold) {
    return {
      status: res.status,
      kind: 'conflict',
      needsNewHold: true,
      raw,
      message:
        'Tus lugares ya no están reservados: la reserva expiró o alguien más los tomó. Vuelve al evento y elige de nuevo — no se te cobró nada.',
    };
  }

  if (res.status === 400) {
    return {
      status: 400,
      kind: 'validation',
      raw,
      // El detalle del API es útil (dice qué campo), pero llega en inglés y sin
      // contexto; se antepone la instrucción y se conserva el detalle.
      message: raw
        ? `Revisa los datos de la compra: ${raw}`
        : 'Revisa los datos de la compra: alguno no es válido.',
    };
  }

  if (res.status === 401 || res.status === 403) {
    if (/método de pago|payment method|no está disponible en el canal/i.test(raw)) {
      return {
        status: res.status,
        kind: 'credential',
        raw,
        message: 'Ese método de pago no está disponible en la venta en línea. Elige tarjeta, SPEI u OXXO.',
      };
    }
    if (/fraud/i.test(raw)) {
      return {
        status: res.status,
        kind: 'credential',
        raw,
        message:
          'No pudimos validar esta compra. Escríbenos desde el correo del comprador para revisarla; no se realizó ningún cargo.',
      };
    }
    return {
      status: res.status,
      kind: 'credential',
      raw,
      message:
        'No tienes acceso a esta orden con este enlace. Ábrelo desde el correo de confirmación o inicia sesión con el correo de la compra.',
    };
  }

  if (res.status === 429) {
    const retryAfterSeconds = parseRetryAfter(res);
    return {
      status: 429,
      kind: 'rate-limit',
      raw,
      retryAfterSeconds,
      message: `Demasiados intentos en poco tiempo. ${formatWaitHint(retryAfterSeconds)}`,
    };
  }

  if (res.status >= 500) {
    return {
      status: res.status,
      kind: 'server',
      raw,
      message: 'Tuvimos un problema de nuestro lado. Vuelve a intentarlo; si se repite, no se te habrá cobrado.',
    };
  }

  return { status: res.status, kind: 'unknown', raw, message: raw || fallback };
}

/** Fallo sin respuesta (offline, DNS, CORS). */
export function networkError(error: unknown): ApiErrorInfo {
  return {
    status: 0,
    kind: 'network',
    raw: error instanceof Error ? error.message : String(error),
    message: 'No pudimos conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.',
  };
}
