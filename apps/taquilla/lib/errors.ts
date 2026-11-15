import { ApiError } from './auth';

const SPANISH =
  /[áéíóúñ¿¡]|\b(el|la|los|las|de|del|no|sin|que|para|ya|un|una|turno|boleto|orden|caja)\b/i;

/**
 * Mensaje para la persona en la ventanilla. El texto del API solo se muestra si
 * ya viene en español; si viene en inglés o con jerga, se usa uno propio.
 */
export function friendlyError(err: unknown, fallback: string, notFound?: string): string {
  if (err instanceof ApiError) {
    if ((err.status === 404 || err.status === 400) && notFound) return notFound;
    if (err.status === 401) return 'Tu sesión terminó. Vuelve a entrar.';
    if (err.status === 403) return 'Tu cuenta no puede hacer esto. Pide ayuda a tu gerente.';
    if (err.status >= 500) return 'El servidor no respondió. Intenta de nuevo en un momento.';
    if (err.message && SPANISH.test(err.message) && !/^HTTP \d+/.test(err.message)) {
      return err.message;
    }
    return fallback;
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'Sin conexión. Revisa la red e intenta de nuevo.';
  }
  if (err instanceof Error && err.message && SPANISH.test(err.message)) return err.message;
  return fallback;
}
