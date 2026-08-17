import { HttpError } from '@/lib/http';

/** El motor de IA aún no expone el endpoint (404/501) o la ruta no existe. */
export function isAiServiceUnavailable(error: unknown): boolean {
  if (!(error instanceof HttpError) || error.status === null) return false;
  return error.status === 404 || error.status === 501 || error.status === 503;
}

export function aiErrorMessage(error: unknown): string {
  if (isAiServiceUnavailable(error)) {
    return 'El motor de IA no está disponible todavía. Los paneles esperan contratos reales y no inventan cifras.';
  }
  if (error instanceof HttpError || error instanceof Error) return error.message;
  return 'No se pudo consultar el motor de IA.';
}
