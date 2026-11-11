import { ApiError } from '@/lib/api';
import { HttpError } from '@/lib/http';

export type LoadFailure = {
  /** Código HTTP, o null si no hubo respuesta. */
  status: number | null;
  /** Qué pasó, en una línea. */
  title: string;
  /** Mensaje del servidor tal cual llegó (no se esconde). */
  detail: string;
};

/** Traduce el error de `lib/http` o `lib/api` a algo que se pueda pintar sin perder el detalle. */
export function describeFailure(error: unknown, endpoint: string): LoadFailure {
  const status =
    error instanceof HttpError ? error.status : error instanceof ApiError ? error.status : null;
  const detail = error instanceof Error && error.message ? error.message : 'Sin detalle.';
  let title = 'No se pudo cargar.';
  // Nest responde «Cannot GET …» cuando la ruta no existe; cualquier otro 404
  // es el recurso (p. ej. una serie de otra organización o borrada).
  if (status === 404 && /^Cannot (GET|POST|PATCH|PUT|DELETE) /.test(detail))
    title = `El API no responde en ${endpoint} (404).`;
  else if (status === 404) title = 'No existe o no pertenece a tu organización.';
  else if (status === 401) title = 'Tu sesión expiró. Vuelve a iniciar sesión.';
  else if (status === 403) title = 'Tu rol no permite ver esto.';
  else if (status != null && status >= 500) title = 'El servidor tuvo un problema.';
  else if (status == null) title = 'No se pudo conectar con el servidor.';
  return { status, title, detail };
}
