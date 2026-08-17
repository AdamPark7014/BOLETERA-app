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
