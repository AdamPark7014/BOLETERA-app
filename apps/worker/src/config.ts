/**
 * Configuración del worker en un solo sitio.
 *
 * Antes vivía como constantes sueltas en `index.ts`, leídas de `process.env` en
 * el momento de importar el módulo. Eso hacía imposible probar un job con otros
 * valores sin ensuciar el entorno del proceso de test, así que la configuración
 * se resuelve ahora en una función pura sobre un `env` que se puede inyectar.
 */

export type WorkerConfig = {
  /** Periodo del tick. Todos los jobs cuelgan del mismo reloj. */
  intervalMs: number;
  /** Holds vencidos por lote; el resto espera al siguiente lote. */
  sweepBatch: number;
  /** Tope de lotes por tick: un backlog enorme no puede monopolizar el proceso. */
  sweepMaxRounds: number;
  /** Bandera histórica de liquidación automática. Ver `pending-payouts`. */
  autoPayout: boolean;
  /** Base del API interno para la conciliación SPEI. */
  apiInternalUrl: string;
  /** Secreto con el que el worker se autentica contra el API interno. */
  internalSecret?: string;
};

/** Entorno mínimo que necesita el worker. Un `Record` para poder inyectarlo. */
export type WorkerEnv = Record<string, string | undefined>;

/**
 * Números de entorno: si la variable falta o no es un número finito y positivo
 * se usa el valor por defecto. Antes un `WORKER_SWEEP_BATCH=abc` producía
 * `Number('abc') = NaN` y el `LIMIT NaN` reventaba el barrido en cada tick.
 */
function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export const DEFAULT_INTERVAL_MS = 30_000;
export const DEFAULT_SWEEP_BATCH = 500;
export const DEFAULT_SWEEP_MAX_ROUNDS = 20;

export function loadConfig(env: WorkerEnv = process.env): WorkerConfig {
  return {
    intervalMs: positiveInt(env.WORKER_INTERVAL_MS, DEFAULT_INTERVAL_MS),
    sweepBatch: positiveInt(env.WORKER_SWEEP_BATCH, DEFAULT_SWEEP_BATCH),
    sweepMaxRounds: positiveInt(env.WORKER_SWEEP_MAX_ROUNDS, DEFAULT_SWEEP_MAX_ROUNDS),
    autoPayout: env.WORKER_AUTO_PAYOUT === 'true',
    apiInternalUrl: env.API_INTERNAL_URL || 'http://localhost:4000/api/v1',
    internalSecret: env.INTERNAL_API_SECRET || env.JWT_SECRET,
  };
}
