/**
 * Mensaje para la persona a partir de un error del API. Nunca se pinta el
 * `message` técnico del servidor (inglés, IDs, «Event not found»): se traduce
 * por estado HTTP y solo pasa tal cual un texto que ya viene en español claro.
 */
export function userMessage(
  status: number | null | undefined,
  raw?: string | string[] | null,
  fallback = 'Algo salió mal. Intenta de nuevo.'
): string {
  const text = (Array.isArray(raw) ? raw.join('. ') : (raw ?? '')).trim();
  const looksSpanish = /[áéíóúñ¿¡]/i.test(text) && !/\b(error|not found|forbidden)\b/i.test(text);
  const technical = /[a-z0-9]{20,}|\bat\b.+:\d+|Exception|stack|undefined|null/i.test(text);
  if (text && looksSpanish && !technical && text.length <= 160) return text;

  switch (status) {
    case 0:
      return 'Sin conexión. Revisa tu red e intenta de nuevo.';
    case 400:
    case 422:
      return 'Revisa los datos e intenta de nuevo.';
    case 401:
      return 'Tu sesión terminó. Vuelve a entrar.';
    case 403:
      return 'No tienes permiso para esto.';
    case 404:
      return 'No lo encontramos.';
    case 409:
      return 'Alguien más lo cambió primero. Actualiza e intenta de nuevo.';
    case 429:
      return 'Demasiados intentos. Espera un momento.';
    case 500:
    case 502:
    case 503:
    case 504:
      return 'Tenemos un problema temporal. Intenta en unos minutos.';
    default:
      return fallback;
  }
}
