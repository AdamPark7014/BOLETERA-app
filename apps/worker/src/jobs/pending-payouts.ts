import type { Job, Logger, PayoutsDb } from '../ports';

/**
 * Liquidaciones a promotores pendientes.
 *
 * Este job SÓLO avisa. No marca nada como pagado y no debe hacerlo mientras no
 * exista un carril bancario real: dar por completada una transferencia que
 * nunca salió del banco es dinero que el promotor cree tener y no tiene.
 *
 * `WORKER_AUTO_PAYOUT` existe desde antes y se sigue leyendo para que el log
 * diga en voz alta que se está ignorando. Borrar la variable en silencio haría
 * creer a quien la puso que la liquidación automática está corriendo.
 */
const PENDING = 'PENDING';

/** Tope por tick: el aviso no necesita paginar toda la cola. */
export const PAYOUT_SCAN_LIMIT = 20;

export type PendingPayoutsDeps = {
  db: PayoutsDb;
  logger: Logger;
  autoPayout: boolean;
};

/** Devuelve cuántas liquidaciones pendientes encontró (0 = no hay nada que avisar). */
export async function reportPendingPayouts(deps: PendingPayoutsDeps): Promise<number> {
  const pending = await deps.db.promoterPayout.findMany({
    where: { status: PENDING },
    take: PAYOUT_SCAN_LIMIT,
  });
  if (!pending.length) return 0;

  deps.logger.info(
    `Payouts pending (manual settlement required): ${pending.length}` +
      (deps.autoPayout ? ' — WORKER_AUTO_PAYOUT ignored until bank rail exists' : ''),
  );
  return pending.length;
}

export function createPendingPayoutsJob(deps: PendingPayoutsDeps): Job {
  return {
    name: 'processPendingPayouts',
    async run() {
      await reportPendingPayouts(deps);
    },
  };
}
