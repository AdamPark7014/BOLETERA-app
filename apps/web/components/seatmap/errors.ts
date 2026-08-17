/**
 * Traducción de los errores de `/inventory/*` a mensajes que dicen QUÉ HACER.
 *
 * El API contesta `{ statusCode, message, error }` (ver AllExceptionsFilter) y
 * sus mensajes están pensados para desarrolladores («Seat ck123 held by another
 * user»). Aquí se convierten en algo accionable en español, y —cuando el 409
 * nombra una butaca— se extrae el id para poder señalarla en el mapa en vez de
 * dejar al comprador mirando un spinner.
 */

export type InventoryErrorKind =
  /** Bug del cliente: falta o es inválido el sessionId. No se muestra tal cual. */
  | 'session'
  /** 409: otro comprador se llevó la butaca mientras la elegíamos. */
  | 'seat-taken'
  /** 409: tope de 10 boletos apartados por sesión. */
  | 'hold-limit'
  /** 429: throttle de 30 holds/min. */
  | 'throttled'
  /** 403: el hold es de otra sesión. */
  | 'forbidden'
  /** 503 / Redis caído. */
  | 'unavailable'
  | 'not-found'
  | 'invalid'
  | 'offline'
  | 'unknown';

export type InventoryError = {
  kind: InventoryErrorKind;
  /** Listo para pintar en pantalla. */
  message: string;
  /** Butaca concreta que se perdió, si el servidor la nombró. */
  seatId?: string;
  /** El cliente puede reintentar solo (tras arreglar lo suyo). */
  selfHealing: boolean;
  /** Conviene refrescar el inventario: lo que el usuario ve está obsoleto. */
  staleMap: boolean;
};

/** El servidor nombra la butaca en «Seat <id> held by another user». */
function extractSeatId(message: string): string | undefined {
  const match = /seat\s+([A-Za-z0-9_-]{6,})/i.exec(message);
  return match?.[1];
}

function messageOf(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const raw = (body as { message?: unknown }).message;
  if (typeof raw === 'string') return raw;
  // class-validator devuelve string[] cuando falla un DTO.
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === 'string').join('. ');
  return '';
}

/**
 * @param status código HTTP
 * @param body   cuerpo ya parseado (o undefined si no era JSON)
 */
export function describeInventoryError(status: number, body?: unknown): InventoryError {
  const raw = messageOf(body);
  const lower = raw.toLowerCase();

  if (status === 400 && lower.includes('sessionid')) {
    return {
      kind: 'session',
      // No se enseña: se regenera la sesión y se reintenta una vez.
      message: 'Reintentando la reserva…',
      selfHealing: true,
      staleMap: false,
    };
  }

  if (status === 409 && (lower.includes('hold limit') || lower.includes('máximo'))) {
    return {
      kind: 'hold-limit',
      message:
        'Ya tienes 10 boletos apartados, que es el máximo por sesión. Termina esa compra o libera boletos antes de elegir más.',
      selfHealing: false,
      staleMap: false,
    };
  }

  if (status === 409) {
    const seatId = extractSeatId(raw);
    return {
      kind: 'seat-taken',
      message: seatId
        ? 'Otro comprador apartó esa butaca mientras la elegías. La marcamos en el mapa: elige otra y continúa.'
        : 'Alguna de tus butacas se apartó justo antes que tú. Actualizamos el mapa: revisa tu selección y vuelve a intentarlo.',
      seatId,
      selfHealing: false,
      staleMap: true,
    };
  }

  if (status === 429) {
    return {
      kind: 'throttled',
      message: 'Hiciste demasiados intentos seguidos. Espera unos 30 segundos y vuelve a intentarlo.',
      selfHealing: false,
      staleMap: false,
    };
  }

  if (status === 403) {
    return {
      kind: 'forbidden',
      message:
        'Esa reserva pertenece a otra sesión de compra. Recarga la página para volver a empezar con tus boletos.',
      selfHealing: false,
      staleMap: true,
    };
  }

  if (status === 404) {
    return {
      kind: 'not-found',
      message: 'Ese boleto ya no existe. Actualizamos el mapa para que elijas otro.',
      selfHealing: false,
      staleMap: true,
    };
  }

  if (status === 503) {
    return {
      kind: 'unavailable',
      message: 'El sistema de apartado está saturado en este momento. Espera unos segundos y reintenta.',
      selfHealing: false,
      staleMap: false,
    };
  }

  if (status === 400) {
    return {
      kind: 'invalid',
      message:
        lower.includes('not enough') || lower.includes('quantity')
          ? 'No quedan suficientes boletos juntos en esa zona. Prueba con menos boletos o con otra zona.'
          : 'No pudimos procesar la reserva con esos datos. Revisa tu selección e inténtalo de nuevo.',
      selfHealing: false,
      staleMap: true,
    };
  }

  return {
    kind: 'unknown',
    message: 'No pudimos apartar tus boletos. Espera unos segundos y vuelve a intentarlo.',
    selfHealing: false,
    staleMap: true,
  };
}

/** Fallo de red / API caída: no hay status que traducir. */
export function describeNetworkError(): InventoryError {
  return {
    kind: 'offline',
    message: 'Perdimos la conexión con el servidor. Revisa tu internet y vuelve a intentarlo.',
    selfHealing: false,
    staleMap: false,
  };
}
