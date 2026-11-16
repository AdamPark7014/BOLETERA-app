/**
 * Traduce el mensaje de error del API a una frase en español para la interfaz.
 *
 * El API responde a veces en inglés («Event not found», «Forbidden resource»)
 * o con texto técnico. Si el mensaje ya está en español se respeta, porque
 * suele ser una regla de negocio útil («El cupo excede el aforo»); si no, se
 * cambia por una frase genérica según el estado HTTP. El texto crudo nunca
 * llega a la pantalla.
 */

const SPANISH_HINT =
  /[áéíóúñ¿¡]|\b(el|la|los|las|de|del|no|una?|para|con|ya|est[aá]|debe|puede)\b/i;

export function looksSpanish(message: string): boolean {
  return (
    SPANISH_HINT.test(message) && !/\b(the|not|found|is|was|must|cannot|invalid)\b/i.test(message)
  );
}

export function genericMessage(status: number | null | undefined, raw = ''): string {
  if (!status) return 'No pudimos conectar. Revisa tu conexión e intenta de nuevo.';
  if (status === 401) return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  if (status === 403) return 'No tienes acceso a esto.';
  if (status === 404 || /not found/i.test(raw)) return 'No encontramos lo que buscas.';
  if (status === 409) return 'Alguien más cambió esto. Recarga e intenta de nuevo.';
  if (status === 429) return 'Demasiados intentos. Espera un momento.';
  if (status >= 500) return 'No pudimos completar esto. Intenta de nuevo en unos segundos.';
  return 'Revisa los datos e intenta de nuevo.';
}

/** Mensaje presentable: el del API si ya es español claro; si no, uno genérico. */
export function userFacingMessage(
  raw: string | null | undefined,
  status: number | null | undefined
): string {
  const text = (raw ?? '').trim();
  if (status && status >= 500) return genericMessage(status, text);
  if (text && text.length <= 160 && looksSpanish(text)) return text;
  return genericMessage(status, text);
}

/** `true` si el API dijo «no encontrado», aunque haya respondido 400. */
export function isNotFoundMessage(
  status: number | null | undefined,
  raw: string | null | undefined
): boolean {
  return status === 404 || /not found|no encontr/i.test(raw ?? '');
}
