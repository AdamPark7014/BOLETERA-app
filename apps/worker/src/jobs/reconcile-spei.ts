import type { Job, Logger } from '../ports';

/**
 * Conciliación SPEI contra Banorte.
 *
 * El worker NO habla con el banco: pide al API que concilie. La lógica de
 * pagos, sus credenciales y su idempotencia viven en `@boletera/payments`,
 * detrás del API — duplicarlas aquí sería un segundo camino por el que marcar
 * una orden como pagada.
 *
 * Se autentica con `INTERNAL_API_SECRET` en la cabecera `X-Internal-Secret`.
 */

/** Forma de la respuesta del endpoint interno de conciliación. */
export type SpeiReconcileResult = {
  checked?: number;
  completed?: number;
};

/** `fetch` inyectable: en test no se abre un socket. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status?: number;
  json(): Promise<unknown>;
}>;

export type ReconcileSpeiDeps = {
  apiInternalUrl: string;
  internalSecret?: string;
  logger: Logger;
  fetchFn?: FetchLike;
};

export const SPEI_RECONCILE_PATH = '/payments/reconcile/spei';

/**
 * Devuelve lo conciliado, o `null` si no se pudo hablar con el API.
 *
 * `null` es un resultado legítimo y silencioso: el worker arranca junto al API
 * en el mismo `docker compose`, así que durante los primeros segundos el API
 * todavía no responde. Un error por tick en ese caso sólo entrena a operaciones
 * a ignorar el log.
 */
export async function reconcileSpei(
  deps: ReconcileSpeiDeps,
): Promise<SpeiReconcileResult | null> {
  const fetchFn = deps.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const url = `${deps.apiInternalUrl}${SPEI_RECONCILE_PATH}`;

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      // Sin secreto se manda la petición igual: es el API quien decide si
      // acepta una llamada interna sin firmar, no el worker.
      headers: deps.internalSecret ? { 'X-Internal-Secret': deps.internalSecret } : {},
    });
  } catch {
    return null; // API caído o aún arrancando.
  }

  if (!response.ok) return null;

  let data: SpeiReconcileResult;
  try {
    data = ((await response.json()) ?? {}) as SpeiReconcileResult;
  } catch {
    // 200 con cuerpo ilegible: se trata como "no se pudo conciliar" en vez de
    // reventar el tick de las demás tareas.
    return null;
  }

  if (data.completed) {
    deps.logger.info(`Banorte SPEI: completed ${data.completed}/${data.checked}`);
  }
  return data;
}

export function createReconcileSpeiJob(deps: ReconcileSpeiDeps): Job {
  return {
    name: 'reconcileBanorteSpei',
    async run() {
      await reconcileSpei(deps);
    },
  };
}
