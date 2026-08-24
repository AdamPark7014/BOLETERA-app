import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { SaleWindowService } from '../event-management/sale-window.service';
import { HoldStatus, Prisma, SalesChannel, TicketStatus } from '@prisma/client';
import { isWebLikeChannel } from '../../common/sales-channel';
import { randomUUID } from 'crypto';
import { Observable, concatMap, filter, finalize, interval, map, shareReplay } from 'rxjs';
import { RedisService } from '../../common/redis.service';
import { ChannelQuotaService } from '../channel-management/channel-quota.service';
import { PrismaService } from '../prisma/prisma.service';
import { WaitlistService } from '../waitlist/waitlist.service';

const HOLD_TTL_WEB_SECONDS = 900;
const HOLD_TTL_TAQUILLA_SECONDS = 300;

/** La ficha lateral del hold en Redis sobrevive al hold para poder liberarlo tarde. */
const HOLD_META_TTL_MARGIN_SECONDS = 3600;

/** Cota dura de boletos por hold: el canal público es el que muerde. */
const MAX_TICKETS_PER_HOLD_WEB = 20;
const MAX_TICKETS_PER_HOLD_STAFF = 100;

/**
 * F1-13b: tope de boletos simultáneos en hold por sesión.
 * Se lleva en Redis, no en BD: `SeatHold.sessionId` no está indexado y una
 * agregación por sesión en el camino caliente del onsale sería un seq scan
 * por cada intento de reserva (30k/min). Es un límite anti-abuso, no un
 * invariante: si Redis no está, el CAS en BD sigue impidiendo la sobreventa.
 */
const MAX_ACTIVE_TICKETS_PER_SESSION = Number(
  process.env.INVENTORY_MAX_ACTIVE_TICKETS_PER_SESSION ?? 10,
);

/** Transacciones interactivas: con contención de asientos 5s por defecto se queda corto. */
const TX_TIMEOUT_MS = Number(process.env.INVENTORY_TX_TIMEOUT_MS ?? 15_000);
const TX_MAX_WAIT_MS = Number(process.env.INVENTORY_TX_MAX_WAIT_MS ?? 5_000);

/** SSE (F1-08). */
const STREAM_TICK_MS = Number(process.env.INVENTORY_STREAM_TICK_MS ?? 3_000);
const STREAM_HEARTBEAT_MS = Number(process.env.INVENTORY_STREAM_HEARTBEAT_MS ?? 25_000);
const STREAM_MAX_CHANGES = 2_000;
const STREAM_MAX_BOUNDARY_IDS = 5_000;
/**
 * `updatedAt` se sella al INICIO de la transacción (Prisma lo fija al construir
 * la query; `now()` en SQL es el instante de arranque de la tx), no al commit.
 * Sin este margen una transacción lenta publicaría su cambio "en el pasado",
 * con el cursor ya por delante, y ese cambio no se emitiría nunca.
 */
const STREAM_SAFETY_LAG_MS = Number(process.env.INVENTORY_STREAM_LAG_MS ?? 1_000);

/** Snapshot agregado: cache en proceso alineado con el `max-age=5` de la respuesta. */
const AVAILABILITY_CACHE_MS = 5_000;
const AVAILABILITY_CACHE_MAX_ENTRIES = 512;
const SEAT_PAGE_DEFAULT = 500;
const SEAT_PAGE_MAX = 2_000;

type HoldMeta = {
  /** Candado Redis del asiento numerado, con su token de propiedad. */
  lockKey?: string;
  lockToken?: string;
  /** F1-11: boletos concretos que reclamó este hold de admisión general. */
  ticketIds?: string[];
};

type TicketChange = {
  id: string;
  seatId: string | null;
  offerId: string;
  status: TicketStatus;
};

type StreamPayload =
  | {
      type: 'delta';
      eventId: string;
      since: string;
      until: string;
      truncated: boolean;
      changes: TicketChange[];
    }
  | { type: 'heartbeat'; eventId: string; at: string };

type StreamCursor = {
  since: Date;
  /** Ids ya emitidos con `updatedAt` exactamente igual al cursor (desempate). */
  boundaryIds: Set<string>;
  lastEmitAt: number;
};

type AvailabilitySnapshot = {
  eventId: string;
  generatedAt: string;
  /** Cursor sugerido para arrancar el SSE sin agujero entre snapshot y deltas. */
  since: string;
  totalTickets: number;
  totals: Record<string, number>;
  byOffer: Array<{ offerId: string; total: number; counts: Record<string, number> }>;
  activeHolds: number;
};

const seatLockKey = (eventId: string, seatId: string) => `hold:${eventId}:${seatId}`;
const holdMetaKey = (holdId: string) => `hold:meta:${holdId}`;
const sessionBudgetKey = (eventId: string, sessionId: string) =>
  `hold:budget:${eventId}:${sessionId}`;
const holdIdempotencyKey = (eventId: string, key: string) => `hold:idemp:${eventId}:${key}`;

type HoldCreateResult = { holds: Awaited<ReturnType<PrismaService['seatHold']['create']>>[]; expiresAt: Date };

type StoredHoldIdempotency = {
  fingerprint: string;
  holdIds: string[];
  expiresAt: string;
};

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  /**
   * F1-08: UN productor por evento, compartido por todos los suscriptores.
   * Antes cada suscripción abría su propio `interval` con un snapshot completo:
   * 30.000 visores × 45.000 boletos / 3 s ≈ 450M filas/s. Ahora N suscriptores
   * generan 1 consulta incremental cada tick.
   */
  private readonly streams = new Map<string, Observable<MessageEvent>>();
  private readonly streamCursors = new Map<string, StreamCursor>();

  /** Cache de snapshots agregados; guarda la promesa para colapsar la estampida. */
  private readonly availabilityCache = new Map<
    string,
    { at: number; value: Promise<AvailabilitySnapshot> }
  >();

  /** Dedupe concurrente de reintentos con la misma Idempotency-Key (por proceso). */
  private readonly holdIdempotencyInflight = new Map<string, Promise<HoldCreateResult>>();

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private quotas: ChannelQuotaService,
    private waitlist: WaitlistService,
    private saleWindow: SaleWindowService,
  ) {}

  private holdTtl(channel: SalesChannel) {
    return isWebLikeChannel(channel) ? HOLD_TTL_WEB_SECONDS : HOLD_TTL_TAQUILLA_SECONDS;
  }

  /**
   * F1-15: comportamiento explícito cuando Redis no responde.
   * `INVENTORY_REQUIRE_REDIS=true` (implícito en producción) hace fallar la
   * reserva en vez de seguir sin candado. Redis es sólo la PRIMERA línea: la
   * garantía real es el CAS en BD más el índice único parcial
   * `SeatHold_active_seat_unique`.
   */
  private requireRedis(): boolean {
    const raw = process.env.INVENTORY_REQUIRE_REDIS;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return process.env.NODE_ENV === 'production';
  }

  async getMap(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        seatMap: { include: { layout: { include: { sections: { include: { seats: true } } } } } },
      },
    });
    if (!event?.seatMap) throw new NotFoundException('Seat map not found');
    return event.seatMap.snapshotData;
  }

  // ---------------------------------------------------------------------------
  // Disponibilidad (F1-08)
  // ---------------------------------------------------------------------------

  /**
   * Snapshot AGREGADO. Ya no devuelve la lista completa de boletos: con 45.000
   * butacas eso eran ~45.000 filas por petición y por visor.
   * El detalle por asiento vive en `getSeatPage`, paginado.
   */
  async getAvailability(eventId: string): Promise<AvailabilitySnapshot> {
    const cached = this.availabilityCache.get(eventId);
    if (cached && Date.now() - cached.at < AVAILABILITY_CACHE_MS) return cached.value;

    const value = this.loadAvailability(eventId).catch((error: unknown) => {
      this.availabilityCache.delete(eventId); // no cachear fallos
      throw error;
    });
    this.availabilityCache.set(eventId, { at: Date.now(), value });
    this.pruneAvailabilityCache();
    return value;
  }

  /** Un evento visitado una vez no debe quedarse en memoria para siempre. */
  private pruneAvailabilityCache() {
    if (this.availabilityCache.size <= AVAILABILITY_CACHE_MAX_ENTRIES) return;
    const cutoff = Date.now() - AVAILABILITY_CACHE_MS;
    for (const [key, entry] of this.availabilityCache) {
      if (entry.at < cutoff) this.availabilityCache.delete(key);
    }
  }

  private async loadAvailability(eventId: string): Promise<AvailabilitySnapshot> {
    const [grouped, activeHolds] = await Promise.all([
      // Un solo groupBy por (offerId, status): los totales se derivan en memoria.
      this.prisma.ticket.groupBy({
        by: ['offerId', 'status'],
        where: { eventId },
        _count: { _all: true },
      }),
      this.prisma.seatHold.count({
        where: { eventId, status: HoldStatus.ACTIVE, expiresAt: { gt: new Date() } },
      }),
    ]);

    const totals: Record<string, number> = {};
    const byOfferMap = new Map<string, { total: number; counts: Record<string, number> }>();
    let totalTickets = 0;

    for (const row of grouped) {
      const count = row._count._all;
      totalTickets += count;
      totals[row.status] = (totals[row.status] ?? 0) + count;
      const entry = byOfferMap.get(row.offerId) ?? { total: 0, counts: {} };
      entry.total += count;
      entry.counts[row.status] = (entry.counts[row.status] ?? 0) + count;
      byOfferMap.set(row.offerId, entry);
    }
    // Estados sin filas se emiten en 0 para que el cliente no tenga que adivinar.
    for (const status of Object.values(TicketStatus)) totals[status] ??= 0;

    const now = new Date();
    return {
      eventId,
      generatedAt: now.toISOString(),
      since: new Date(now.getTime() - STREAM_SAFETY_LAG_MS).toISOString(),
      totalTickets,
      totals,
      byOffer: [...byOfferMap.entries()].map(([offerId, v]) => ({ offerId, ...v })),
      activeHolds,
    };
  }

  /**
   * Detalle por asiento, paginado por keyset sobre la PK. Quien necesite pintar
   * el mapa completo debe recorrer las páginas, no pedir 45.000 filas de golpe.
   */
  async getSeatPage(
    eventId: string,
    opts: { cursor?: string; limit?: number; status?: TicketStatus } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? SEAT_PAGE_DEFAULT, 1), SEAT_PAGE_MAX);
    const rows = await this.prisma.ticket.findMany({
      where: {
        eventId,
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.cursor ? { id: { gt: opts.cursor } } : {}),
      },
      select: {
        id: true,
        seatId: true,
        offerId: true,
        status: true,
        section: true,
        row: true,
        seatNumber: true,
      },
      orderBy: { id: 'asc' },
      take: limit + 1, // el extra sólo sirve para saber si hay más
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      eventId,
      items,
      limit,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  /**
   * SSE de deltas, un productor por evento compartido con `shareReplay`.
   * Emite sólo lo que cambió desde la última marca (índice `Ticket(eventId, updatedAt)`).
   */
  streamAvailability(eventId: string): Observable<MessageEvent> {
    const existing = this.streams.get(eventId);
    if (existing) return existing;

    // Se declara antes para que `finalize` pueda comprobar que sigue siendo
    // ESTE stream el publicado, y no borrar por error uno recién creado.
    // El cursor lo crea `pollAvailabilityDelta` de forma perezosa: si el último
    // suscriptor se va justo antes de que otro se suscriba a la misma
    // referencia, shareReplay revive la fuente y el cursor debe re-sembrarse.
    let stream!: Observable<MessageEvent>;
    stream = interval(STREAM_TICK_MS).pipe(
      concatMap(() => this.pollAvailabilityDelta(eventId)), // concatMap: nunca solapa consultas
      filter((payload): payload is StreamPayload => payload !== null),
      map((payload) => ({ data: JSON.stringify(payload) }) as MessageEvent),
      finalize(() => {
        // F1-08(4): al llegar refCount a cero se desmonta el productor y se
        // limpia el Map; si no, cada evento visitado fugaría un interval.
        if (this.streams.get(eventId) === stream) this.streams.delete(eventId);
        this.streamCursors.delete(eventId);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    this.streams.set(eventId, stream);
    return stream;
  }

  private async pollAvailabilityDelta(eventId: string): Promise<StreamPayload | null> {
    let state = this.streamCursors.get(eventId);
    if (!state) {
      // Arranca en el pasado inmediato: el cliente ya trae su snapshot.
      state = {
        since: new Date(Date.now() - STREAM_SAFETY_LAG_MS),
        boundaryIds: new Set(),
        lastEmitAt: Date.now(),
      };
      this.streamCursors.set(eventId, state);
    }

    try {
      const until = new Date(Date.now() - STREAM_SAFETY_LAG_MS);
      if (until <= state.since) return this.heartbeatIfDue(eventId, state);

      const sinceBefore = state.since;
      const rows = await this.prisma.ticket.findMany({
        where: { eventId, updatedAt: { gte: state.since, lte: until } },
        select: { id: true, seatId: true, offerId: true, status: true, updatedAt: true },
        orderBy: { updatedAt: 'asc' },
        take: STREAM_MAX_CHANGES,
      });
      const truncated = rows.length === STREAM_MAX_CHANGES;
      // `gte` reemite el borde; los ids ya vistos en ese milisegundo se filtran.
      const fresh = rows.filter((row) => !state.boundaryIds.has(row.id));

      if (rows.length) {
        const newest = rows[rows.length - 1].updatedAt;
        state.since = newest;
        state.boundaryIds = new Set(
          rows.filter((row) => row.updatedAt.getTime() === newest.getTime()).map((row) => row.id),
        );
        if (state.boundaryIds.size > STREAM_MAX_BOUNDARY_IDS) {
          // Carga masiva en el mismo milisegundo: preferimos avanzar (y quizá
          // duplicar un cambio, que es idempotente) antes que crecer sin tope.
          state.boundaryIds = new Set();
          state.since = new Date(newest.getTime() + 1);
        }
      } else {
        state.since = until;
        state.boundaryIds = new Set();
      }

      if (!fresh.length) return this.heartbeatIfDue(eventId, state);

      state.lastEmitAt = Date.now();
      return {
        type: 'delta',
        eventId,
        since: sinceBefore.toISOString(),
        until: state.since.toISOString(),
        truncated,
        changes: fresh.map((row) => ({
          id: row.id,
          seatId: row.seatId,
          offerId: row.offerId,
          status: row.status,
        })),
      };
    } catch (error) {
      // Nunca propagamos: un error corta el stream COMPARTIDO y provoca una
      // reconexión simultánea de todos los suscriptores del evento.
      this.logger.warn(`Delta poll failed for ${eventId}: ${(error as Error).message}`);
      return null;
    }
  }

  /** Latido periódico: sin él un evento tranquilo deja morir la conexión en los proxies. */
  private heartbeatIfDue(eventId: string, state: StreamCursor): StreamPayload | null {
    if (Date.now() - state.lastEmitAt < STREAM_HEARTBEAT_MS) return null;
    state.lastEmitAt = Date.now();
    return { type: 'heartbeat', eventId, at: new Date().toISOString() };
  }

  // ---------------------------------------------------------------------------
  // Reservas
  // ---------------------------------------------------------------------------

  async createHold(dto: {
    eventId: string;
    seatIds?: string[];
    offerId?: string;
    quantity?: number;
    userId?: string;
    sessionId?: string;
    channel?: SalesChannel;
    cashierId?: string;
    idempotencyKey?: string;
    /** Llamadas internas ya autorizadas (POS, layout) pueden saltar el tope por sesión. */
    skipSessionLimit?: boolean;
  }): Promise<HoldCreateResult> {
    const idempotencyKey = dto.idempotencyKey?.trim() || undefined;
    const idempInflightKey = idempotencyKey ? `${dto.eventId}:${idempotencyKey}` : undefined;

    if (idempInflightKey) {
      const inflight = this.holdIdempotencyInflight.get(idempInflightKey);
      if (inflight) return inflight;

      const replay = await this.replayIdempotentHold(dto, idempotencyKey);
      if (replay) return replay;

      const promise = this.createHoldCore(dto, idempotencyKey).finally(() => {
        this.holdIdempotencyInflight.delete(idempInflightKey);
      });
      this.holdIdempotencyInflight.set(idempInflightKey, promise);
      return promise;
    }

    return this.createHoldCore(dto, undefined);
  }

  private async createHoldCore(
    dto: {
      eventId: string;
      seatIds?: string[];
      offerId?: string;
      quantity?: number;
      userId?: string;
      sessionId?: string;
      channel?: SalesChannel;
      cashierId?: string;
      skipSessionLimit?: boolean;
    },
    idempotencyKey: string | undefined,
  ): Promise<HoldCreateResult> {
    const channel = dto.channel ?? SalesChannel.WEB;
    // Duplicar un asiento en la petición se auto-bloquearía contra el índice único.
    const seatIds = dto.seatIds?.length ? [...new Set(dto.seatIds)] : undefined;
    const quantity = seatIds?.length ?? dto.quantity ?? 0;

    if (!seatIds?.length && !(dto.offerId && dto.quantity)) {
      throw new BadRequestException('seatIds or offerId+quantity required');
    }
    const maxPerHold = isWebLikeChannel(channel)
      ? MAX_TICKETS_PER_HOLD_WEB
      : MAX_TICKETS_PER_HOLD_STAFF;
    if (quantity < 1 || quantity > maxPerHold) {
      throw new BadRequestException(`quantity must be between 1 and ${maxPerHold}`);
    }

    // Se reserva cupo de sesión ANTES de tocar la BD; todo lo que venga después
    // va dentro del try para devolverlo si la reserva no llega a cuajar.
    // La ventana de venta se comprueba ANTES de tocar inventario: apartar fuera
    // de horario y descubrirlo al cobrar deja butacas retenidas por una compra
    // que nunca podrá completarse.
    // Además de la ventana, se aparta cupo de la fase activa: sin esto,
    // `allocationPercent` era una promesa que el producto hacía y no cumplía —
    // se podía vender el 100% en preventa y dejar la venta general sin nada.
    // El apartado es atómico en Redis, así que dos compras simultáneas obtienen
    // valores distintos y solo una puede cruzar el límite.
    const window = await this.saleWindow.assertSaleWindowOpenAndReserve(dto.eventId, {
      channel,
      quantity,
    });

    try {
      await this.assertSessionBudget(dto, channel, quantity);
    } catch (error) {
      await this.saleWindow.releasePhaseQuota(window.quota);
      throw error;
    }

    const ttl = this.holdTtl(channel);
    const expiresAt = new Date(Date.now() + ttl * 1000);

    try {
      await this.quotas.assertAvailable(dto.eventId, channel, quantity);
      const result = seatIds?.length
        ? await this.createReservedSeatHold(dto, seatIds, channel, ttl, expiresAt)
        : await this.createGeneralAdmissionHold(dto, dto.offerId!, quantity, channel, ttl, expiresAt);
      if (idempotencyKey) {
        await this.persistIdempotentHold(dto, idempotencyKey, result, ttl);
      }
      return result;
    } catch (error) {
      // Cupo apartado que nunca llegó a ser hold: la reconciliación no lo vería
      // en la base, así que aquí sí hay que compensar a mano.
      await this.saleWindow.releasePhaseQuota(window.quota);
      await this.refundSessionBudget(dto, channel, quantity);
      throw error;
    }
  }

  /**
   * Asiento numerado. El CAS `updateMany ... WHERE status = AVAILABLE` ya era
   * correcto; lo que faltaba (F1-12) es que TODA la reserva multiasiento fuera
   * atómica: antes, si fallaba el asiento k+1, los k anteriores quedaban HELD
   * con `SeatHold` huérfanos hasta expirar.
   */
  private async createReservedSeatHold(
    dto: {
      eventId: string;
      offerId?: string;
      userId?: string;
      sessionId?: string;
      cashierId?: string;
    },
    seatIds: string[],
    channel: SalesChannel,
    ttl: number,
    expiresAt: Date,
  ) {
    // Indexado por seatId, no por posición: si Redis está caído y degradamos,
    // el array quedaría desalineado respecto a los holds creados.
    const locks = new Map<string, { key: string; token: string }>();
    try {
      for (const seatId of seatIds) {
        const key = seatLockKey(dto.eventId, seatId);
        const token = randomUUID();
        const outcome = await this.redis.acquireLock(key, token, ttl);
        if (outcome === 'ACQUIRED') {
          locks.set(seatId, { key, token });
          continue;
        }
        if (outcome === 'TAKEN') {
          throw new ConflictException(`Seat ${seatId} held by another user`);
        }
        // UNAVAILABLE — decisión explícita, ya no un `if` silencioso.
        if (this.requireRedis()) {
          throw new ServiceUnavailableException(
            'Seat locking unavailable (Redis down). Retry in a few seconds.',
          );
        }
      }

      const holds = await this.prisma.$transaction(
        async (tx) => {
          const created = [];
          for (const seatId of seatIds) {
            // CAS en un solo viaje. El `findFirst` + `updateMany` anterior ya era
            // correcto, pero eran dos idas y vueltas por asiento DENTRO de la
            // transacción, alargando el tiempo con los row locks tomados justo
            // cuando 30.000 personas pelean por el mismo mapa.
            // La subconsulta acota a una fila; el `AND status = AVAILABLE` de
            // fuera es el CAS: bajo READ COMMITTED, si otra transacción tenía la
            // fila, Postgres reevalúa al desbloquear y devuelve 0 filas.
            const claimed = await tx.$queryRaw<Array<{ id: string; offerId: string }>>`
              UPDATE "Ticket"
                 SET status = 'HELD'::"TicketStatus", "updatedAt" = now()
               WHERE id = (
                 SELECT id FROM "Ticket"
                  WHERE "eventId" = ${dto.eventId}
                    AND "seatId" = ${seatId}
                    AND status = 'AVAILABLE'::"TicketStatus"
                  ORDER BY id
                    FOR UPDATE SKIP LOCKED
                  LIMIT 1
               )
                 AND status = 'AVAILABLE'::"TicketStatus"
              RETURNING id, "offerId"`;
            if (!claimed.length) throw new ConflictException(`Seat ${seatId} not available`);

            created.push(
              await tx.seatHold.create({
                data: {
                  eventId: dto.eventId,
                  seatId,
                  offerId: dto.offerId ?? claimed[0].offerId,
                  userId: dto.userId,
                  sessionId: dto.sessionId,
                  channel,
                  cashierId: dto.cashierId,
                  quantity: 1,
                  expiresAt,
                },
              }),
            );
          }
          return created;
        },
        { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS },
      );

      // Ficha lateral: guarda el token para poder liberar el candado siendo su
      // dueño. Vive más que el hold para cubrir liberaciones tardías.
      await Promise.all(
        holds.map((hold) => {
          const lock = locks.get(hold.seatId);
          if (!lock) return Promise.resolve(false); // degradado sin Redis
          const meta: HoldMeta = { lockKey: lock.key, lockToken: lock.token };
          return this.redis.setJson(
            holdMetaKey(hold.id),
            meta,
            ttl + HOLD_META_TTL_MARGIN_SECONDS,
          );
        }),
      );

      return { holds, expiresAt };
    } catch (error) {
      // F1-12: sin esto los candados ya tomados quedaban retenidos hasta su TTL
      // aunque la transacción hubiera revertido.
      await this.releaseLocks(locks);
      throw this.translateUniqueViolation(error);
    }
  }

  /**
   * F1-02(a): admisión general con CAS real.
   *
   * Antes: `findMany` de N disponibles + `update` uno a uno por id, sin
   * revalidar el estado → dos peticiones simultáneas leían el mismo conjunto y
   * ambas "ganaban". Ahora un único UPDATE ... WHERE id IN (SELECT ... FOR
   * UPDATE SKIP LOCKED LIMIT n): las transacciones concurrentes se reparten
   * filas distintas sin bloquearse entre sí.
   */
  private async createGeneralAdmissionHold(
    dto: { eventId: string; userId?: string; sessionId?: string; cashierId?: string },
    offerId: string,
    quantity: number,
    channel: SalesChannel,
    ttl: number,
    expiresAt: Date,
  ) {
    const { holds, ticketsByHold } = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.$queryRaw<Array<{ id: string }>>`
          UPDATE "Ticket"
             SET status = 'HELD'::"TicketStatus", "updatedAt" = now()
           WHERE id IN (
             SELECT id FROM "Ticket"
              WHERE "eventId" = ${dto.eventId}
                AND "offerId" = ${offerId}
                AND status = 'AVAILABLE'::"TicketStatus"
              ORDER BY id
                FOR UPDATE SKIP LOCKED
              LIMIT ${quantity}::int
           )
          RETURNING id`;

        if (claimed.length < quantity) {
          // Lanzar aborta la transacción: los boletos reclamados vuelven solos a
          // AVAILABLE por rollback, sin UPDATE compensatorio que pueda fallar.
          throw new ConflictException(
            `Only ${claimed.length} of ${quantity} tickets available for this offer`,
          );
        }

        // Una fila de SeatHold por boleto (quantity: 1). El módulo de órdenes
        // deriva la cantidad del NÚMERO de holds, no de `hold.quantity`:
        // agruparlos en una sola fila facturaría un boleto en vez de N.
        const created = [];
        const ticketsByHold: Array<{ holdId: string; ticketId: string }> = [];
        for (const ticket of claimed) {
          const hold = await tx.seatHold.create({
            data: {
              eventId: dto.eventId,
              offerId,
              userId: dto.userId,
              sessionId: dto.sessionId,
              channel,
              cashierId: dto.cashierId,
              quantity: 1,
              expiresAt,
            },
          });
          created.push(hold);
          ticketsByHold.push({ holdId: hold.id, ticketId: ticket.id });
        }
        return { holds: created, ticketsByHold };
      },
      { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS },
    );

    // F1-11: correlación hold → boleto concreto. `SeatHold` no tiene columna
    // para esto y el esquema es intocable en esta ola, así que la ficha va a
    // Redis. Si no está, `releaseHold` cae al modo por conteo (ver allí).
    await Promise.all(
      ticketsByHold.map((entry) =>
        this.redis.setJson(
          holdMetaKey(entry.holdId),
          { ticketIds: [entry.ticketId] } satisfies HoldMeta,
          ttl + HOLD_META_TTL_MARGIN_SECONDS,
        ),
      ),
    );

    return { holds, expiresAt };
  }

  /**
   * Pick N best-available seats for an offer (contiguous same-row when possible),
   * or GA quantity holds when tickets have no seat.
   */
  async createBestAvailableHold(dto: {
    eventId: string;
    offerId: string;
    quantity: number;
    sessionId?: string;
    userId?: string;
    channel?: SalesChannel;
    cashierId?: string;
    contiguous?: boolean;
    skipSessionLimit?: boolean;
    idempotencyKey?: string;
  }) {
    const quantity = Math.min(Math.max(dto.quantity || 1, 1), 12);
    const offer = await this.prisma.offer.findFirst({
      where: { id: dto.offerId, eventId: dto.eventId, isAvailable: true },
    });
    if (!offer) throw new NotFoundException('Offer not found');

    const candidates = await this.prisma.ticket.findMany({
      where: {
        eventId: dto.eventId,
        offerId: dto.offerId,
        status: TicketStatus.AVAILABLE,
      },
      orderBy: [{ section: 'asc' }, { row: 'asc' }, { seatNumber: 'asc' }],
      take: Math.max(quantity * 8, 40),
    });
    if (candidates.length < quantity) {
      throw new BadRequestException('Not enough tickets available');
    }

    const withSeats = candidates.filter((t) => t.seatId);
    if (withSeats.length >= quantity) {
      const picked =
        dto.contiguous === false
          ? withSeats.slice(0, quantity)
          : (this.pickContiguousSeats(withSeats, quantity) ?? withSeats.slice(0, quantity));
      const seatIds = picked.map((t) => t.seatId!).filter(Boolean);
      const result = await this.createHold({
        eventId: dto.eventId,
        seatIds,
        offerId: dto.offerId,
        sessionId: dto.sessionId,
        userId: dto.userId,
        channel: dto.channel,
        cashierId: dto.cashierId,
        skipSessionLimit: dto.skipSessionLimit,
        idempotencyKey: dto.idempotencyKey,
      });
      return {
        ...result,
        seats: picked.map((t) => ({
          seatId: t.seatId,
          section: t.section,
          row: t.row,
          seatNumber: t.seatNumber,
          label: [t.section, t.row, t.seatNumber].filter(Boolean).join(' · '),
        })),
        mode: 'RESERVED' as const,
      };
    }

    const result = await this.createHold({
      eventId: dto.eventId,
      offerId: dto.offerId,
      quantity,
      sessionId: dto.sessionId,
      userId: dto.userId,
      channel: dto.channel,
      cashierId: dto.cashierId,
      skipSessionLimit: dto.skipSessionLimit,
      idempotencyKey: dto.idempotencyKey,
    });
    return {
      ...result,
      seats: [],
      mode: 'GA' as const,
    };
  }

  private pickContiguousSeats<
    T extends { section: string | null; row: string | null; seatNumber: string | null },
  >(tickets: T[], quantity: number): T[] | null {
    const groups = new Map<string, T[]>();
    for (const t of tickets) {
      const key = `${t.section ?? ''}::${t.row ?? ''}`;
      const list = groups.get(key) ?? [];
      list.push(t);
      groups.set(key, list);
    }
    for (const row of groups.values()) {
      const sorted = [...row].sort(
        (a, b) => this.seatNum(a.seatNumber) - this.seatNum(b.seatNumber),
      );
      for (let i = 0; i <= sorted.length - quantity; i++) {
        const slice = sorted.slice(i, i + quantity);
        let contiguous = true;
        for (let j = 1; j < slice.length; j++) {
          if (this.seatNum(slice[j].seatNumber) !== this.seatNum(slice[j - 1].seatNumber) + 1) {
            contiguous = false;
            break;
          }
        }
        if (contiguous) return slice;
      }
    }
    return null;
  }

  private seatNum(value: string | null | undefined) {
    const n = parseInt(String(value ?? '').replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  }

  // ---------------------------------------------------------------------------
  // Liberación
  // ---------------------------------------------------------------------------

  /**
   * @param requester cuando viene (llamadas desde HTTP) se exige propiedad.
   *   Las llamadas internas ya autorizadas (POS, layout) lo omiten.
   */
  async releaseHold(
    holdId: string,
    requester?: {
      sessionId?: string;
      userId?: string;
      staff?: boolean;
      staffRole?: string;
      staffOrganizationId?: string | null;
    },
  ) {
    const hold = await this.prisma.seatHold.findUnique({ where: { id: holdId } });
    if (!hold) throw new NotFoundException('Hold not found');
    if (requester?.staff) {
      await this.assertStaffOwnsEvent(hold.eventId, requester);
    } else if (requester) {
      this.assertHoldOwnership(hold, requester);
    }

    // CAS primero: si el hold ya fue CONVERTED (pagado) o RELEASED, no debemos
    // tocar sus boletos. El `update` incondicional anterior podía degradar un
    // hold ya convertido y devolver a la venta boletos de una orden viva.
    const claimed = await this.prisma.seatHold.updateMany({
      where: { id: holdId, status: HoldStatus.ACTIVE },
      data: { status: HoldStatus.RELEASED, releasedAt: new Date() },
    });
    if (claimed.count === 0) return { released: false, reason: 'not_active' as const };

    const meta = await this.redis.getJson<HoldMeta>(holdMetaKey(holdId));

    if (hold.seatId) {
      if (meta?.lockKey && meta.lockToken) {
        await this.redis.releaseLock(meta.lockKey, meta.lockToken);
      }
      // Sin ficha no borramos el candado a ciegas (F1-15): borraríamos el de
      // otro. Vive en el mismo Redis que la ficha, así que si la ficha no está
      // el candado tampoco; en el peor caso expira solo por TTL.
      await this.prisma.ticket.updateMany({
        where: { eventId: hold.eventId, seatId: hold.seatId, status: TicketStatus.HELD },
        data: { status: TicketStatus.AVAILABLE },
      });
    } else if (hold.offerId) {
      await this.releaseGeneralAdmissionTickets(hold, meta);
    }

    await this.redis.del(holdMetaKey(holdId));
    if (hold.sessionId && isWebLikeChannel(hold.channel)) {
      await this.redis.decrement(sessionBudgetKey(hold.eventId, hold.sessionId), hold.quantity);
    }

    void this.waitlist.notifyBatch(hold.eventId, 5).catch(() => undefined);

    return { released: true };
  }

  /**
   * F1-11: antes se liberaba *cualquier* boleto HELD del offer, que podía ser
   * el de otro comprador a mitad de pago.
   *
   * Camino preferente: la ficha en Redis dice EXACTAMENTE qué boleto reclamó
   * este hold, así que la liberación es precisa.
   *
   * LIMITACIÓN: si la ficha no está (Redis caído o purgado) no hay forma de
   * reconstruir la correlación — `SeatHold` no tiene columna de boletos y el
   * esquema está fuera de alcance en esta ola. El respaldo libera exactamente
   * `hold.quantity` boletos HELD del offer con LIMIT vía subconsulta, eligiendo
   * los de `updatedAt` más antiguo (los retenidos hace más tiempo, es decir los
   * que con mayor probabilidad ya venían de un hold vencido). Garantiza el
   * CONTEO correcto, no la identidad. La solución definitiva es una columna
   * `SeatHold.ticketIds` o una tabla puente hold↔ticket.
   */
  private async releaseGeneralAdmissionTickets(
    hold: { eventId: string; offerId: string | null; quantity: number },
    meta: HoldMeta | null,
  ) {
    if (meta?.ticketIds?.length) {
      await this.prisma.ticket.updateMany({
        where: { id: { in: meta.ticketIds }, eventId: hold.eventId, status: TicketStatus.HELD },
        data: { status: TicketStatus.AVAILABLE },
      });
      return;
    }

    await this.prisma.$executeRaw`
      UPDATE "Ticket"
         SET status = 'AVAILABLE'::"TicketStatus", "updatedAt" = now()
       WHERE id IN (
         SELECT id FROM "Ticket"
          WHERE "eventId" = ${hold.eventId}
            AND "offerId" = ${hold.offerId}
            AND status = 'HELD'::"TicketStatus"
          ORDER BY "updatedAt" ASC
            FOR UPDATE SKIP LOCKED
          LIMIT ${hold.quantity}::int
       )`;
  }

  /**
   * Liberación administrativa acotada a la propia organización.
   *
   * `assertHoldOwnership` salía con `return` en cuanto el solicitante era
   * personal, así que cualquier cuenta con rol de taquilla podía liberar holds
   * de eventos de OTRO promotor — devolviendo a la venta butacas ajenas en
   * pleno onsale. Sólo SUPER_ADMIN atraviesa organizaciones (F2-08).
   */
  private async assertStaffOwnsEvent(
    eventId: string,
    requester: { staffRole?: string; staffOrganizationId?: string | null },
  ) {
    if (requester.staffRole === 'SUPER_ADMIN') return;

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { organizationId: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    if (!requester.staffOrganizationId || requester.staffOrganizationId !== event.organizationId) {
      throw new ForbiddenException('El hold pertenece a otra organización');
    }
  }

  private assertHoldOwnership(
    hold: { sessionId: string | null; userId: string | null },
    requester: { sessionId?: string; userId?: string; staff?: boolean },
  ) {
    if (requester.staff) return;
    if (requester.userId && hold.userId && hold.userId === requester.userId) return;
    if (requester.sessionId && hold.sessionId && hold.sessionId === requester.sessionId) return;
    // F1-13b: sin esto `DELETE /inventory/holds/:id` liberaba el hold de cualquiera.
    throw new ForbiddenException('Hold belongs to another session');
  }

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------

  private async releaseLocks(locks: Map<string, { key: string; token: string }>) {
    await Promise.all(
      [...locks.values()].map((lock) => this.redis.releaseLock(lock.key, lock.token)),
    );
  }

  /**
   * El índice único parcial `SeatHold_active_seat_unique` rechaza en BD un
   * segundo hold ACTIVE sobre la misma butaca. Sin traducir, Prisma P2002
   * saldría como 500; es un conflicto de negocio, no un fallo del servidor.
   */
  private translateUniqueViolation(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('Seat already held by another user');
    }
    return error;
  }

  private async assertSessionBudget(
    dto: { eventId: string; sessionId?: string; skipSessionLimit?: boolean },
    channel: SalesChannel,
    quantity: number,
  ) {
    if (dto.skipSessionLimit || !isWebLikeChannel(channel) || !dto.sessionId) return;
    const key = sessionBudgetKey(dto.eventId, dto.sessionId);
    const total = await this.redis.incrementWithTtl(key, quantity, this.holdTtl(channel));
    if (total === null) return; // Redis caído: el límite es anti-abuso, no invariante
    if (total > MAX_ACTIVE_TICKETS_PER_SESSION) {
      await this.redis.decrement(key, quantity);
      throw new ConflictException(
        `Session hold limit reached: máximo ${MAX_ACTIVE_TICKETS_PER_SESSION} boletos ` +
          'apartados a la vez. Completa o libera los actuales antes de apartar más.',
      );
    }
  }

  private async refundSessionBudget(
    dto: { eventId: string; sessionId?: string; skipSessionLimit?: boolean },
    channel: SalesChannel,
    quantity: number,
  ) {
    if (dto.skipSessionLimit || !isWebLikeChannel(channel) || !dto.sessionId) return;
    await this.redis.decrement(sessionBudgetKey(dto.eventId, dto.sessionId), quantity);
  }

  /** Huella estable del cuerpo de la reserva para detectar reutilización indebida de la clave. */
  private holdRequestFingerprint(dto: {
    seatIds?: string[];
    offerId?: string;
    quantity?: number;
  }) {
    const seatIds = dto.seatIds?.length ? [...new Set(dto.seatIds)].sort() : [];
    return JSON.stringify({
      seatIds,
      offerId: dto.offerId ?? null,
      quantity: dto.quantity ?? null,
    });
  }

  /** Reintento con la misma Idempotency-Key: devuelve los holds vivos ya creados. */
  private async replayIdempotentHold(
    dto: {
      eventId: string;
      seatIds?: string[];
      offerId?: string;
      quantity?: number;
    },
    idempotencyKey: string,
  ): Promise<HoldCreateResult | null> {
    const cached = await this.redis.getJson<StoredHoldIdempotency>(
      holdIdempotencyKey(dto.eventId, idempotencyKey),
    );
    if (!cached) return null;

    const fingerprint = this.holdRequestFingerprint(dto);
    if (cached.fingerprint !== fingerprint) {
      throw new ConflictException(
        'Idempotency-Key reused with a different hold request',
      );
    }

    const now = new Date();
    const holds = await this.prisma.seatHold.findMany({
      where: {
        id: { in: cached.holdIds },
        eventId: dto.eventId,
        status: HoldStatus.ACTIVE,
        expiresAt: { gt: now },
      },
    });
    if (holds.length !== cached.holdIds.length) return null;

    return { holds, expiresAt: new Date(cached.expiresAt) };
  }

  private async persistIdempotentHold(
    dto: { eventId: string; seatIds?: string[]; offerId?: string; quantity?: number },
    idempotencyKey: string,
    result: HoldCreateResult,
    ttlSeconds: number,
  ) {
    const payload: StoredHoldIdempotency = {
      fingerprint: this.holdRequestFingerprint(dto),
      holdIds: result.holds.map((h) => h.id),
      expiresAt: result.expiresAt.toISOString(),
    };
    await this.redis.setJson(
      holdIdempotencyKey(dto.eventId, idempotencyKey),
      payload,
      ttlSeconds + HOLD_META_TTL_MARGIN_SECONDS,
    );
  }
}
