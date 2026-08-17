import { HttpError } from '@/lib/http';

export function isSponsorshipsUnavailable(error: unknown): boolean {
  if (!(error instanceof HttpError) || error.status === null) return false;
  return error.status === 404 || error.status === 501 || error.status === 503;
}

export function sponsorshipsErrorMessage(error: unknown): string {
  if (isSponsorshipsUnavailable(error)) {
    return 'La API de patrocinios aún no está disponible. No se inventan contratos ni ROI.';
  }
  if (error instanceof HttpError || error instanceof Error) return error.message;
  return 'No se pudo consultar patrocinios.';
}
