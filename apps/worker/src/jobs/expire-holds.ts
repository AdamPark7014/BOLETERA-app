import type { ExpiredHold, HoldsDb, Job, Logger, SweepTx } from '../ports';

/**
 * F1-10: barrido de holds vencidos.
 *
 * Sin este job un carrito abandonado retiene sus asientos para siempre: en un
 * onsale eso es inventario muerto en el minuto 1.
 *
 * Antes sólo devolvía a AVAILABLE los boletos con `seatId`. Los holds de
 * admisión general (sin asiento) se marcaban EXPIRED pero sus boletos quedaban
 * HELD para siempre: fuga permanente de inventario en cada onsale.
 *
 * Además: lock distribuido, lotes acotados y aislamiento de fallos, para que
 * escalar el worker a N réplicas no multiplique el trabajo ni un lote malo
 * detenga el resto de tareas.
 *
 * ESTADOS: se usan literales en vez del enum de Prisma a propósito — los enums
 * de Prisma son cadenas en tiempo de ejecución, y no importarlos es lo que
 * permite probar este archivo sin el cliente generado.
 */
const HELD = 'HELD';
const AVAILABLE = 'AVAILABLE';

/**
 * Identificador arbitrario del barrido de holds para el advisory lock de
 * Postgres. Se prefiere a Redis porque el worker no depende hoy de Redis y el
 * lock de transacción se suelta solo en el commit/rollback (imposible dejarlo
 * colgado si el proceso muere). Sin él, N réplicas hacen el mismo trabajo.
 */
export const HOLD_SWEEP_LOCK_ID = 7301472109;

/** Otra réplica tiene el barrido tomado; este tick no hace nada. */
export const SWEEP_LOCKED = -1;

export type HoldGrouping = {
  /** eventId -> asientos a devolver a AVAILABLE. */
  seatsByEvent: Map<string, string[]>;
  /** `${eventId}|${offerId}` -> cuántos boletos de admisión general soltar. */
  gaQuantityByOffer: Map<string, number>;
};

export function gaKey(eventId: string, offerId: string): string {
  return `${eventId}|${offerId}`;
}

/** Deshace `gaKey`. */
export function parseGaKey(key: string): { eventId: string; offerId: string } {
  const [eventId, offerId] = key.split('|');
  return { eventId, offerId };
}

/**
 * Agrupa los holds vencidos para trabajar por conjuntos: una consulta por
 * evento/oferta en vez de dos por hold (500 holds eran 1.000 idas y vueltas).
 *
 * Es pura a propósito: es la parte del barrido donde de verdad se puede colar
 * un error de conteo, y así se prueba sin base de datos.
 */
export function groupExpiredHolds(holds: readonly ExpiredHold[]): HoldGrouping {
  const seatsByEvent = new Map<string, string[]>();
  const gaQuantityByOffer = new Map<string, number>();

  for (const hold of holds) {
    if (hold.seatId) {
      const list = seatsByEvent.get(hold.eventId) ?? [];
      list.push(hold.seatId);
      seatsByEvent.set(hold.eventId, list);
    } else if (hold.offerId) {
      const key = gaKey(hold.eventId, hold.offerId);
      // `|| 1`: un hold de admisión general sin cantidad sigue reteniendo un
      // boleto. Contar 0 lo dejaría HELD para siempre.
      gaQuantityByOffer.set(key, (gaQuantityByOffer.get(key) ?? 0) + (hold.quantity || 1));
    }
    // Un hold sin `seatId` y sin `offerId` no retiene inventario identificable:
    // ya quedó EXPIRED en el UPDATE y no hay nada que devolver.
  }

  return { seatsByEvent, gaQuantityByOffer };
}

/**
 * Un lote = una transacción. Devuelve el número de holds procesados,
 * o `SWEEP_LOCKED` si otra réplica tiene el barrido tomado.
 */
export async function sweepBatch(db: HoldsDb, batchSize: number): Promise<number> {
  return db.$transaction(
    async (tx: SweepTx) => {
      const lockRows = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${HOLD_SWEEP_LOCK_ID}) AS locked`;
      if (!lockRows[0]?.locked) return SWEEP_LOCKED;

      // CAS + SKIP LOCKED: cada transacción se lleva holds distintos y sólo
      // los que siguen ACTIVE, así que reprocesar nunca libera de más.
      const expired = await tx.$queryRaw<ExpiredHold[]>`
        UPDATE "SeatHold" AS h
           SET status = 'EXPIRED'::"HoldStatus", "releasedAt" = now()
         WHERE h.id IN (
           SELECT id FROM "SeatHold"
            WHERE status = 'ACTIVE'::"HoldStatus"
              AND "expiresAt" < now()
            ORDER BY "expiresAt" ASC
              FOR UPDATE SKIP LOCKED
            LIMIT ${batchSize}::int
         )
        RETURNING h.id, h."eventId", h."seatId", h."offerId", h.quantity`;

      if (!expired.length) return 0;

      const { seatsByEvent, gaQuantityByOffer } = groupExpiredHolds(expired);

      for (const [eventId, seatIds] of seatsByEvent) {
        await tx.ticket.updateMany({
          where: { eventId, seatId: { in: seatIds }, status: HELD },
          data: { status: AVAILABLE },
        });
      }

      for (const [key, quantity] of gaQuantityByOffer) {
        const { eventId, offerId } = parseGaKey(key);
        // LIMITACIÓN: `SeatHold` no guarda qué boletos concretos reclamó un hold
        // de admisión general (no hay columna y el esquema está fuera de alcance),
        // así que aquí sólo se garantiza el CONTEO. Se ordena por `updatedAt`
        // ascendente para soltar primero los retenidos hace más tiempo, que son
        // precisamente los de los holds vencidos.
        // `updatedAt` se fija a mano: el SSE de disponibilidad lee por
        // `Ticket(eventId, updatedAt)` y sin esto el cambio sería invisible.
        await tx.$executeRaw`
          UPDATE "Ticket"
             SET status = 'AVAILABLE'::"TicketStatus", "updatedAt" = now()
           WHERE id IN (
             SELECT id FROM "Ticket"
              WHERE "eventId" = ${eventId}
                AND "offerId" = ${offerId}
                AND status = 'HELD'::"TicketStatus"
              ORDER BY "updatedAt" ASC
                FOR UPDATE SKIP LOCKED
              LIMIT ${quantity}::int
           )`;
      }

      return expired.length;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

export type ExpireHoldsDeps = {
  db: HoldsDb;
  logger: Logger;
  batchSize: number;
  maxRounds: number;
  /** Sustituible en test para ejercitar el bucle sin transacciones reales. */
  runBatch?: (db: HoldsDb, batchSize: number) => Promise<number>;
};

/**
 * Bucle de lotes de un tick. Devuelve cuántos holds liberó, para que el test
 * pueda afirmar sobre el resultado y no sólo sobre el log.
 *
 * Reglas del bucle, que son las que de verdad importan:
 *  - `SWEEP_LOCKED` (otra réplica) y `0` (nada pendiente) cortan el tick.
 *  - un lote incompleto significa que ya no queda backlog: se corta.
 *  - un lote que revienta NO puede tumbar el barrido ni las demás tareas; los
 *    holds siguen ACTIVE y el próximo tick los reintenta.
 */
export async function sweepExpiredHolds(deps: ExpireHoldsDeps): Promise<number> {
  const runBatch = deps.runBatch ?? sweepBatch;
  let total = 0;

  for (let round = 0; round < deps.maxRounds; round++) {
    let processed: number;
    try {
      processed = await runBatch(deps.db, deps.batchSize);
    } catch (error) {
      deps.logger.error(`Hold sweep batch failed: ${(error as Error).message}`);
      break;
    }
    if (processed <= 0) break; // 0 = nada pendiente, -1 = otra réplica barriendo
    total += processed;
    if (processed < deps.batchSize) break;
  }

  if (total) deps.logger.info(`Released ${total} expired holds`);
  return total;
}

/**
 * El job listo para el scheduler, con su propio cerrojo de re-entrada: el
 * barrido puede durar más que el intervalo si hay backlog, y dos ticks
 * solapados dentro del MISMO proceso duplicarían el trabajo.
 */
export function createExpireHoldsJob(deps: ExpireHoldsDeps): Job {
  let sweeping = false;

  return {
    name: 'releaseExpiredHolds',
    async run() {
      if (sweeping) return;
      sweeping = true;
      try {
        await sweepExpiredHolds(deps);
      } finally {
        sweeping = false;
      }
    },
  };
}
