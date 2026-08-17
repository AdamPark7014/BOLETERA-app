import 'dotenv/config';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env from project root for development (from apps/worker/src, go up 3 levels to root)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { prisma, PayoutStatus, TicketStatus } from '@boletera/database';

const INTERVAL_MS = 30_000;
const AUTO_PAYOUT = process.env.WORKER_AUTO_PAYOUT === 'true';

/** Holds vencidos por pasada de barrido; el resto espera al siguiente lote. */
const SWEEP_BATCH = Number(process.env.WORKER_SWEEP_BATCH ?? 500);
/** Tope de lotes por tick: evita que un backlog enorme monopolice el proceso. */
const SWEEP_MAX_ROUNDS = Number(process.env.WORKER_SWEEP_MAX_ROUNDS ?? 20);

/**
 * Evita que dos ticks se solapen dentro del MISMO proceso (el barrido puede
 * durar más que el intervalo si hay backlog).
 */
let sweeping = false;

type ExpiredHold = {
  id: string;
  eventId: string;
  seatId: string | null;
  offerId: string | null;
  quantity: number;
};

/**
 * F1-10: barrido de holds vencidos.
 *
 * Antes sólo devolvía a AVAILABLE los boletos con `seatId`. Los holds de
 * admisión general (sin asiento) se marcaban EXPIRED pero sus boletos quedaban
 * HELD para siempre: fuga permanente de inventario en cada onsale.
 *
 * Además: lock distribuido, lotes acotados y aislamiento de fallos, para que
 * escalar el worker a N réplicas no multiplique el trabajo ni un lote malo
 * detenga el resto de tareas.
 */
async function releaseExpiredHolds() {
  if (sweeping) return;
  sweeping = true;
  let totalHolds = 0;

  try {
    for (let round = 0; round < SWEEP_MAX_ROUNDS; round++) {
      let processed: number;
      try {
        processed = await sweepBatch();
      } catch (error) {
        // Un lote que falla no puede tumbar el barrido ni las demás tareas:
        // los holds siguen ACTIVE y el próximo tick los reintenta.
        console.error(`Hold sweep batch failed: ${(error as Error).message}`);
        break;
      }
      if (processed <= 0) break; // 0 = nada pendiente, -1 = otra réplica barriendo
      totalHolds += processed;
      if (processed < SWEEP_BATCH) break;
    }
    if (totalHolds) console.log(`Released ${totalHolds} expired holds`);
  } finally {
    sweeping = false;
  }
}

/**
 * Un lote = una transacción. Devuelve el número de holds procesados,
 * o -1 si otra réplica tiene el barrido tomado.
 */
async function sweepBatch(): Promise<number> {
  return prisma.$transaction(
    async (tx) => {
      // Lock distribuido con advisory lock de Postgres. Se prefiere a Redis
      // porque el worker no depende hoy de Redis y el lock de transacción se
      // suelta solo en el commit/rollback (imposible dejarlo colgado si el
      // proceso muere). La constante es un identificador arbitrario del
      // barrido de holds. Sin él, N réplicas hacen el mismo trabajo.
      const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(7301472109) AS locked`;
      if (!lock?.locked) return -1;

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
            LIMIT ${SWEEP_BATCH}::int
         )
        RETURNING h.id, h."eventId", h."seatId", h."offerId", h.quantity`;

      if (!expired.length) return 0;

      // Agrupamos para trabajar por conjuntos: una consulta por evento/oferta
      // en vez de dos por hold (500 holds eran 1.000 idas y vueltas).
      const seatsByEvent = new Map<string, string[]>();
      const gaQuantityByOffer = new Map<string, number>();

      for (const hold of expired) {
        if (hold.seatId) {
          const list = seatsByEvent.get(hold.eventId) ?? [];
          list.push(hold.seatId);
          seatsByEvent.set(hold.eventId, list);
        } else if (hold.offerId) {
          const key = `${hold.eventId}|${hold.offerId}`;
          gaQuantityByOffer.set(key, (gaQuantityByOffer.get(key) ?? 0) + (hold.quantity || 1));
        }
      }

      for (const [eventId, seatIds] of seatsByEvent) {
        await tx.ticket.updateMany({
          where: { eventId, seatId: { in: seatIds }, status: TicketStatus.HELD },
          data: { status: TicketStatus.AVAILABLE },
        });
      }

      for (const [key, quantity] of gaQuantityByOffer) {
        const [eventId, offerId] = key.split('|');
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

async function processPendingPayouts() {
  const pending = await prisma.promoterPayout.findMany({
    where: { status: PayoutStatus.PENDING },
    take: 20,
  });
  if (!pending.length) return;

  // Never fake-complete bank transfers. Real SPEI-out lands in a later phase.
  console.log(
    `Payouts pending (manual settlement required): ${pending.length}` +
      (AUTO_PAYOUT
        ? ' — WORKER_AUTO_PAYOUT ignored until bank rail exists'
        : ''),
  );
}

async function reconcileBanorteSpei() {
  const api = process.env.API_INTERNAL_URL || 'http://localhost:4000/api/v1';
  const secret = process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET;
  try {
    const res = await fetch(`${api}/payments/reconcile/spei`, {
      method: 'POST',
      headers: secret ? { 'X-Internal-Secret': secret } : {},
    });
    if (res.ok) {
      const data = (await res.json()) as { checked?: number; completed?: number };
      if (data.completed) console.log(`Banorte SPEI: completed ${data.completed}/${data.checked}`);
    }
  } catch {
    /* API offline */
  }
}

/** Ninguna tarea puede tumbar el tick de las demás. */
async function runSafely(name: string, task: () => Promise<unknown>) {
  try {
    await task();
  } catch (error) {
    console.error(`Worker task ${name} failed: ${(error as Error).message}`);
  }
}

console.log(`Boletera worker started (auto-payout=${AUTO_PAYOUT})`);
void runSafely('releaseExpiredHolds', releaseExpiredHolds);

setInterval(() => {
  void runSafely('releaseExpiredHolds', releaseExpiredHolds);
  void runSafely('processPendingPayouts', processPendingPayouts);
  void runSafely('reconcileBanorteSpei', reconcileBanorteSpei);
}, INTERVAL_MS);
