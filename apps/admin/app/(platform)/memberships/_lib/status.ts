import { HttpError } from '@/lib/http';

/** El módulo aún no expone el endpoint (404/501) o está temporalmente caído. */
export function isMembershipsUnavailable(error: unknown): boolean {
  if (!(error instanceof HttpError) || error.status === null) return false;
  return error.status === 404 || error.status === 501 || error.status === 503;
}

export function membershipsErrorMessage(error: unknown): string {
  if (isMembershipsUnavailable(error)) {
    return 'La API de membresías aún no está disponible. No se inventan cifras ni plantillas como datos reales.';
  }
  if (error instanceof HttpError || error instanceof Error) return error.message;
  return 'No se pudo consultar membresías.';
}
