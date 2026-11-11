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

/**
 * Motivo de vacío que el API añade a la respuesta (`reason`) cuando no hay
 * fuente real: p. ej. «sin ventas en el periodo». No está en ai-contracts;
 * se lee de forma defensiva.
 */
export function readAiReason(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const reason = (data as { reason?: unknown }).reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : null;
}

/** «sin ventas en el periodo» → «Sin ventas en el periodo.» */
export function formatAiReason(reason: string): string {
  const text = reason.charAt(0).toUpperCase() + reason.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
