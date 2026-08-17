import {
  AuthenticationError,
  HttpError,
  NetworkError,
  PermissionError,
  RequestAbortedError,
  ServerError,
} from '@/lib/http';

const KNOWN_MESSAGES: ReadonlyArray<readonly [RegExp, string]> = [
  [/invalid credentials|credenciales/i, 'Credenciales inválidas. Verifica tu email y contraseña.'],
  [/password must be at least/i, 'La contraseña debe tener al menos 8 caracteres.'],
  [/invalid or expired reset token/i, 'El enlace de restablecimiento no es válido o ya expiró.'],
  [/invalid refresh token/i, 'Tu sesión expiró. Inicia sesión nuevamente.'],
  [/oauth|sso/i, 'No se pudo completar el inicio de sesión con el proveedor.'],
  [/csrf|forgery/i, 'La sesión de seguridad expiró. Recarga la página e intenta de nuevo.'],
  [/rate limit|too many|throttle/i, 'Demasiados intentos. Espera un momento e intenta de nuevo.'],
  [/user not found|not found/i, 'No encontramos una cuenta con esos datos.'],
  [/inactive|disabled|deactivated/i, 'Esta cuenta está desactivada. Contacta a tu administrador.'],
];

function translateRawMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return 'Ocurrió un error inesperado. Intenta de nuevo.';
  for (const [pattern, spanish] of KNOWN_MESSAGES) {
    if (pattern.test(trimmed)) return spanish;
  }
  // Prefer keeping already-Spanish backend copy; avoid leaking raw English codes.
  if (/[áéíóúñ¿¡]/i.test(trimmed) || !/[A-Za-z]{4,}/.test(trimmed)) {
    return trimmed;
  }
  if (/^[A-Z0-9_]+$/.test(trimmed)) {
    return 'No se pudo completar la solicitud. Intenta de nuevo.';
  }
  return trimmed;
}

export function authErrorMessage(
  error: unknown,
  fallback = 'No se pudo completar la solicitud. Intenta de nuevo.',
): string {
  if (error instanceof RequestAbortedError) {
    return 'La solicitud fue cancelada.';
  }
  if (error instanceof NetworkError) {
    return 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.';
  }
  if (error instanceof PermissionError) {
    return 'No tienes permisos para acceder a este panel.';
  }
  if (error instanceof AuthenticationError) {
    return translateRawMessage(error.message) || 'Credenciales inválidas. Verifica tu email y contraseña.';
  }
  if (error instanceof ServerError) {
    return 'El servidor no pudo completar la solicitud. Intenta de nuevo en unos minutos.';
  }
  if (error instanceof HttpError) {
    if (error.status === 429) {
      return 'Demasiados intentos. Espera un momento e intenta de nuevo.';
    }
    if (error.status === 400 || error.status === 422) {
      return translateRawMessage(error.message);
    }
    return translateRawMessage(error.message) || fallback;
  }
  if (error instanceof Error && error.message) {
    return translateRawMessage(error.message) || fallback;
  }
  return fallback;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
