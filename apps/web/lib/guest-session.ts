'use client';

/**
 * Identidad del comprador invitado (sin JWT).
 *
 * El API exige `sessionId` en todo `POST /inventory/holds*` cuando no hay token
 * (400 si falta) y comprueba propiedad en `DELETE /inventory/holds/:id`
 * (403 si no coincide). Antes cada llamada generaba un `crypto.randomUUID()`
 * nuevo: el hold nacía huérfano —nadie podía liberarlo antes de que expirara— y
 * el límite de holds por sesión no contaba nada porque cada clic era una sesión
 * distinta. El identificador tiene que ser estable por navegador, no por clic.
 *
 * Lo consume el checkout y también el visor de butacas; por eso vive aquí y no
 * dentro de un componente.
 */

export const GUEST_SESSION_STORAGE_KEY = 'boletera_guest_session';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

/**
 * Una identidad emitida por el servidor tiene forma `v2.<id>.<emitido>.<firma>`.
 * Sirve para distinguir la nuestra de una local heredada sin volver a pedirla.
 */
function isServerIssued(value: string | null | undefined): boolean {
  return Boolean(value && value.startsWith('v2.') && value.split('.').length === 4);
}

/** Vuelo en curso: dos selecciones de butaca casi a la vez no piden dos identidades. */
let inFlight: Promise<string> | null = null;

/** Cache en memoria: evita releer localStorage en cada selección de butaca. */
let cachedSessionId: string | null = null;

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Navegadores viejos y contextos no seguros no exponen randomUUID.
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Identificador estable de este navegador. Persiste en `localStorage` para que
 * sobreviva a recargas y a la vuelta desde la pasarela de pago.
 *
 * En SSR devuelve un valor efímero sin persistir: nunca debe llamarse durante
 * el render, solo desde manejadores de eventos o efectos.
 */
export function getGuestSessionId(): string {
  if (cachedSessionId) return cachedSessionId;
  if (typeof window === 'undefined') return randomId();

  try {
    const stored = window.localStorage.getItem(GUEST_SESSION_STORAGE_KEY);
    if (stored && stored.trim()) {
      cachedSessionId = stored.trim();
      return cachedSessionId;
    }
    const fresh = randomId();
    window.localStorage.setItem(GUEST_SESSION_STORAGE_KEY, fresh);
    cachedSessionId = fresh;
    return fresh;
  } catch {
    // Modo privado o almacenamiento bloqueado: al menos que sea estable
    // durante la vida de la pestaña.
    cachedSessionId = cachedSessionId ?? randomId();
    return cachedSessionId;
  }
}

/**
 * Obtiene una identidad EMITIDA Y FIRMADA POR EL SERVIDOR.
 *
 * Antes el navegador se inventaba el identificador, asi que el tope de boletos
 * por comprador se imponia sobre un valor que el propio comprador elegia: bastaba
 * con mandar uno distinto en cada peticion para saltarselo. Ahora la identidad la
 * emite el API y el navegador solo la guarda y la devuelve.
 *
 * Si el API no responde se cae al identificador local de siempre: quedarse sin
 * poder comprar por no haber podido pedir una identidad seria un remedio peor que
 * la enfermedad. El API acepta los locales mientras `GUEST_SESSION_STRICT` este
 * apagado, que es lo que permite hacer la transicion sin tumbar carritos.
 */
export async function ensureGuestSession(): Promise<string> {
  const stored = peekGuestSessionId();
  if (isServerIssued(stored)) {
    cachedSessionId = stored;
    return stored as string;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch(`${API}/inventory/session`, { method: 'POST' });
      if (res.ok) {
        const body = (await res.json()) as { sessionId?: string };
        if (isServerIssued(body?.sessionId)) {
          cachedSessionId = body.sessionId as string;
          try {
            window.localStorage.setItem(GUEST_SESSION_STORAGE_KEY, cachedSessionId);
          } catch {
            /* almacenamiento bloqueado: vale con la copia en memoria */
          }
          return cachedSessionId;
        }
      }
    } catch {
      /* sin red o API caida: seguimos con el identificador local */
    }
    return getGuestSessionId();
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Pide una identidad nueva al servidor. Se usa cuando el API rechaza la actual
 * (caducada o de una version anterior), para reintentar una vez sin molestar al
 * comprador.
 */
export async function renewGuestSession(): Promise<string> {
  cachedSessionId = null;
  inFlight = null;
  try {
    window.localStorage.removeItem(GUEST_SESSION_STORAGE_KEY);
  } catch {
    /* almacenamiento bloqueado */
  }
  return ensureGuestSession();
}

/** Lee el identificador sin crearlo. Útil para no ensuciar el almacenamiento. */
export function peekGuestSessionId(): string | null {
  if (cachedSessionId) return cachedSessionId;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(GUEST_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Cuerpo mínimo que el API espera en holds de invitado. Azúcar para no repetir
 * `sessionId: getGuestSessionId()` en cada llamada y olvidarlo en una.
 */
export function withGuestSession<T extends object>(body: T): T & { sessionId: string } {
  return { ...body, sessionId: getGuestSessionId() };
}

/**
 * Renueva la identidad. Solo tras cerrar sesión o vaciar el carrito: los holds
 * abiertos con la identidad anterior dejan de ser liberables por este navegador.
 */
export function resetGuestSessionId(): string {
  cachedSessionId = null;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(GUEST_SESSION_STORAGE_KEY);
    } catch {
      /* almacenamiento bloqueado: seguimos con el valor en memoria */
    }
  }
  return getGuestSessionId();
}
