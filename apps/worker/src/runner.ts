import type { Job, Logger } from './ports';

/**
 * El reloj del worker y su aislamiento de fallos.
 *
 * Regla única: **ninguna tarea puede tumbar el tick de las demás**. Un fallo de
 * la conciliación SPEI no puede dejar de liberar holds, porque holds sin
 * liberar es inventario que no se vende.
 */

/** Ejecuta un job tragándose su error y dejándolo en el log. */
export async function runSafely(job: Job, logger: Logger): Promise<void> {
  try {
    await job.run();
  } catch (error) {
    logger.error(`Worker task ${job.name} failed: ${(error as Error).message}`);
  }
}

/** Un tick: todos los jobs, cada uno aislado del resto. */
export async function runTick(jobs: readonly Job[], logger: Logger): Promise<void> {
  for (const job of jobs) {
    await runSafely(job, logger);
  }
}

export type Scheduler = {
  /** Para el reloj. Los jobs en vuelo terminan solos. */
  stop(): void;
};

export type StartOptions = {
  jobs: readonly Job[];
  logger: Logger;
  intervalMs: number;
  /**
   * Jobs que se ejecutan de inmediato, sin esperar al primer tick. Al arrancar
   * puede haber holds vencidos desde hace rato — típico tras un despliegue— y
   * esperar 30 s a soltarlos es inventario retenido sin razón.
   */
  immediate?: readonly Job[];
  /** Inyectables para poder probar el reloj sin esperar de verdad. */
  timers?: {
    setInterval: (fn: () => void, ms: number) => unknown;
    clearInterval: (handle: never) => void;
  };
};

export function startScheduler(options: StartOptions): Scheduler {
  const timers = options.timers ?? {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle),
  };

  for (const job of options.immediate ?? []) {
    void runSafely(job, options.logger);
  }

  const handle = timers.setInterval(() => {
    void runTick(options.jobs, options.logger);
  }, options.intervalMs);

  return {
    stop() {
      timers.clearInterval(handle as never);
    },
  };
}
