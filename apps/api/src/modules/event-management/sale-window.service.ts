import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { EventStatus, SalePhaseStatus, SalesChannel } from '@prisma/client';
import { randomUUID } from 'crypto';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolvePhaseStatus } from './sale-phase-status';
import { ProfecoDisclosureService } from './profeco-disclosure.service';
import {
  SalePhaseQuotaService,
  type PhaseQuotaHandle,
  type PhaseQuotaTarget,
} from './sale-phase-quota.service';

/**
 * Motivo de la decisión. El código es estable y pensado para que quien lo
 * consulte (inventario, órdenes, taquilla) pueda mapearlo a su propio error.
 */
export type SaleWindowReason =
  | 'OPEN'
  | 'OPEN_NO_WINDOW'
  | 'NOT_STARTED'
  | 'CLOSED'
  | 'CODE_REQUIRED'
  | 'CHANNEL_NOT_ALLOWED'
  | 'EVENT_NOT_ON_SALE'
  | 'EVENT_NOT_FOUND'
  | 'DISCLOSURE_NOT_PUBLISHED';

export type SaleWindowPhaseView = {
  id: string;
  name: string;
  kind: string;
  startsAt: Date;
  endsAt: Date;
  /** Estado derivado del reloj, no el guardado: nunca va con retraso. */
  status: SalePhaseStatus;
  channels: SalesChannel[];
  maxPerOrder: number | null;
  discountPercent: number | null;
  allocationPercent: number | null;
  requiresCode: boolean;
  priority: number;
};

export type SaleWindowDecision = {
  allowed: boolean;
  reason: SaleWindowReason;
  /** Mensaje listo para mostrar al comprador (español). */
  message: string;
  /** Fase que autoriza la compra, si la hay. */
  phase: SaleWindowPhaseView | null;
  /** Próxima apertura, para que la tienda pueda pintar una cuenta atrás. */
  nextOpensAt: Date | null;
  /** Cierre de la ventana vigente (null si no hay ventana configurada). */
  closesAt: Date | null;
  /** Tope de boletos por orden que impone la fase vigente, si lo impone. */
  maxPerOrder: number | null;
  /** Descuento de la fase vigente, para que el precio salga de un solo sitio. */
  discountPercent: number | null;
  /**
   * Incumplimiento de los lineamientos de PROFECO, si lo hay.
   *
   * Viaja SIEMPRE, bloquee o no, para que el backoffice pueda enseñarlo antes
   * de que llegue una revisión. Que la venta siga abierta no significa que el
   * evento esté en regla.
   */
  complianceWarning: string | null;
};

/**
 * Qué hacer cuando un evento masivo no cumple la divulgación previa.
 *
 * Por omisión AVISA, no bloquea. Bloquear la venta es una decisión de negocio
 * con consecuencias inmediatas —en esta base hay eventos por encima del umbral
 * que ya están vendiendo—, y tomarla en silencio desde el código sería peor que
 * el problema que resuelve. Poner `block` es un acto deliberado.
 *
 *   off   — no comprobar.
 *   warn  — comprobar, registrar y adjuntar el aviso a la decisión (por omisión).
 *   block — denegar la venta con motivo `DISCLOSURE_NOT_PUBLISHED`.
 */
const ENFORCEMENT = (() => {
  const raw = (process.env.PROFECO_ENFORCE_DISCLOSURE ?? 'warn').toLowerCase();
  return raw === 'block' || raw === 'off' ? raw : 'warn';
})();

export type SaleWindowQuery = {
  /** Instante a evaluar. Por defecto, ahora. Útil para simular en el alta. */
  at?: Date;
  /** Canal por el que se intenta vender. Sin canal no se filtra por canal. */
  channel?: SalesChannel;
  /** Código de acceso presentado por el comprador (presales, socios). */
  code?: string;
};

/**
 * Decisión + cupo apartado. `quota` viaja para poder DEVOLVERLO: quien reserva
 * y luego falla (asiento ya tomado, tope de sesión, transacción revertida) tiene
 * que llamar a `releasePhaseQuota` o estará quitándole butacas a la fase por una
 * compra que nunca existió.
 */
export type SaleWindowReservation = SaleWindowDecision & {
  quota: PhaseQuotaHandle | null;
};

/** Cada cuánto se persiste el estado de las fases desde el camino de venta. */
const STATUS_SYNC_INTERVAL_SECONDS = Number(process.env.SALE_PHASE_STATUS_SYNC_SECONDS ?? 30);

const statusSyncKey = (eventId: string) => `salephase:status:${eventId}`;

/** Fila de `SalePhase` tal y como la lee este servicio. */
type SalePhaseRow = {
  id: string;
  name: string;
  kind: string;
  startsAt: Date;
  endsAt: Date;
  status: SalePhaseStatus;
  channels: SalesChannel[];
  maxPerOrder: number | null;
  discountPercent: number | null;
  allocationPercent: number | null;
  code: string | null;
  priority: number;
};

type EventWindowRow = {
  status: EventStatus;
  startsAt: Date;
  totalCapacity: number;
  salesStartAt: Date | null;
  salesEndAt: Date | null;
  salePhases: SalePhaseRow[];
};

/** Lo que resuelve la ventana: decisión, aforo y el evento ya cargado. */
type ResolvedWindow = {
  decision: SaleWindowDecision;
  capacity: number;
  event: EventWindowRow | null;
};

/** Estados en los que un evento no admite venta, pase lo que pase con las fases. */
const NON_SELLABLE_EVENT_STATUS: EventStatus[] = [
  EventStatus.DRAFT,
  EventStatus.CANCELLED,
  EventStatus.COMPLETED,
];

/**
 * Única fuente de verdad sobre "¿se puede comprar ahora mismo?".
 *
 * Vive en `event-management` porque la ventana de venta se configura aquí, pero
 * está pensada para consumirse desde fuera: `inventory` (antes de crear el hold)
 * y `orders` (antes de confirmar) deben llamar a `assertSaleWindowOpen`.
 * Importan `EventManagementModule`, que la exporta.
 */
@Injectable()
export class SaleWindowService {
  private logger = new Logger(SaleWindowService.name);

  constructor(
    private prisma: PrismaService,
    private quota: SalePhaseQuotaService,
    private redis: RedisService,
    private profeco: ProfecoDisclosureService,
  ) {}

  /**
   * Resuelve la ventana de venta sin lanzar. Devuelve siempre una decisión
   * explicada: quien la consulta decide si corta o solo informa.
   */
  async checkSaleWindow(eventId: string, query: SaleWindowQuery = {}): Promise<SaleWindowDecision> {
    return (await this.resolve(eventId, query)).decision;
  }

  /**
   * Decide si la venta está abierta y superpone el cumplimiento de PROFECO.
   *
   * La comprobacion va AQUI, envolviendo, y no repartida por los tres puntos de
   * retorno de `resolveWindow`: si estuviera duplicada, bastaria anadir un
   * cuarto camino de salida para abrir un agujero silencioso por el que vender
   * un evento que no cumple.
   */
  private async resolve(
    eventId: string,
    query: SaleWindowQuery = {},
  ): Promise<ResolvedWindow> {
    const resolved = await this.resolveWindow(eventId, query);

    // Si la venta ya esta cerrada por otro motivo, no hay nada que anadir.
    if (ENFORCEMENT === 'off' || !resolved.decision.allowed || !resolved.event) return resolved;

    let verdict;
    try {
      // Se le pasan el aforo y la fecha de venta que `resolveWindow` YA cargó:
      // volver a consultarlos aquí sería una consulta de más por cada intento
      // de reserva, en el punto más caliente del onsale.
      verdict = await this.profeco.check(eventId, query.at ?? new Date(), {
        salesStartAt: resolved.event.salesStartAt,
        totalCapacity: resolved.event.totalCapacity,
      });
    } catch (error) {
      // Un fallo comprobando NO puede tumbar la venta: seria convertir una
      // funcion de cumplimiento en una caida de ingresos.
      this.logger.error(
        `No se pudo comprobar la divulgacion de ${eventId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return resolved;
    }

    if (verdict.compliant) return resolved;

    this.logger.warn(
      `PROFECO · evento ${eventId} vendiendo sin cumplir (${verdict.reason}): ${verdict.message}`,
    );

    if (ENFORCEMENT === 'block') {
      return {
        ...resolved,
        decision: this.deny('DISCLOSURE_NOT_PUBLISHED', verdict.message, {
          nextOpensAt: verdict.earliestSaleAt,
        }),
      };
    }

    return {
      ...resolved,
      decision: { ...resolved.decision, complianceWarning: verdict.message },
    };
  }

  /**
   * El aforo sale de aquí y no de una consulta aparte porque el cupo de fase se
   * comprueba en el camino caliente del onsale: leerlo dos veces por intento de
   * reserva es una consulta de más por cada compra.
   */
  private async resolveWindow(
    eventId: string,
    query: SaleWindowQuery = {},
  ): Promise<ResolvedWindow> {
    const at = query.at ?? new Date();

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        status: true,
        startsAt: true,
        totalCapacity: true,
        salesStartAt: true,
        salesEndAt: true,
        salePhases: {
          // Cancelada o cerrada a mano es como si no existiera: cerrar una fase
          // antes de su hora es una decisión del promotor y tiene que valer más
          // que el reloj.
          where: {
            status: { notIn: [SalePhaseStatus.CANCELLED, SalePhaseStatus.ENDED] },
          },
          orderBy: [{ priority: 'asc' }, { startsAt: 'asc' }],
        },
      },
    });

    if (!event) {
      return {
        decision: this.deny('EVENT_NOT_FOUND', 'El evento no existe.', { nextOpensAt: null }),
        capacity: 0,
        event: null,
      };
    }

    // Sin await y limitado por candado: el estado guardado converge con el
    // tráfico que ya existe, sin cron y sin alargar la compra. Lo que se
    // DEVUELVE se deriva del reloj, así que la respuesta nunca depende de que
    // esta escritura llegue a ocurrir.
    //
    // Sólo cuando se evalúa AHORA: `query.at` sirve para simular la ventana en
    // el alta, y persistir el resultado de una simulación dejaría las fases con
    // el estado de un futuro que todavía no ha pasado.
    if (!query.at) {
      void this.syncPhaseStatuses(eventId, event.salePhases, at).catch(() => undefined);
    }

    return {
      decision: this.decide(event, query, at),
      capacity: event.totalCapacity ?? 0,
      // El evento viaja para que el cumplimiento no tenga que volver a leerlo.
      event,
    };
  }

  private decide(event: EventWindowRow, query: SaleWindowQuery, at: Date): SaleWindowDecision {
    if (NON_SELLABLE_EVENT_STATUS.includes(event.status)) {
      return this.deny('EVENT_NOT_ON_SALE', 'El evento no está a la venta.', { nextOpensAt: null });
    }

    const phases = event.salePhases;

    // ---- Sin fases: se respeta la ventana suelta del evento -----------------
    if (phases.length === 0) {
      return this.checkLegacyWindow(event, at);
    }

    const code = query.code?.trim().toUpperCase();
    const future = phases.filter((p) => p.startsAt > at);
    const nextOpensAt = future.length
      ? future.reduce((min, p) => (p.startsAt < min ? p.startsAt : min), future[0].startsAt)
      : null;

    const current = phases.filter((p) => p.startsAt <= at && p.endsAt > at);
    if (current.length === 0) {
      // Distinguir "todavía no" de "ya cerró" cambia el mensaje y la UI.
      return nextOpensAt
        ? this.deny('NOT_STARTED', 'La venta aún no abre para este evento.', { nextOpensAt })
        : this.deny('CLOSED', 'La venta para este evento ya cerró.', { nextOpensAt: null });
    }

    // El orden ya viene por prioridad ascendente: la primera que autorice gana.
    let channelBlocked = false;
    let codeMissing = false;

    for (const phase of current) {
      if (query.channel && phase.channels.length > 0 && !phase.channels.includes(query.channel)) {
        channelBlocked = true;
        continue;
      }
      if (phase.code) {
        if (!code || code !== phase.code.trim().toUpperCase()) {
          codeMissing = true;
          continue;
        }
      }
      return {
        allowed: true,
        reason: 'OPEN',
        message: `Venta abierta: ${phase.name}.`,
        phase: this.toPhaseView(phase, at),
        nextOpensAt,
        closesAt: phase.endsAt,
        maxPerOrder: phase.maxPerOrder,
        discountPercent: phase.discountPercent,
        complianceWarning: null,
      };
    }

    if (codeMissing) {
      return this.deny('CODE_REQUIRED', 'Esta fase de venta requiere código de acceso.', {
        nextOpensAt,
      });
    }
    if (channelBlocked) {
      return this.deny('CHANNEL_NOT_ALLOWED', 'La fase de venta vigente no permite este canal.', {
        nextOpensAt,
      });
    }
    return this.deny('CLOSED', 'La venta para este evento no está abierta.', { nextOpensAt });
  }

  /**
   * Igual que `checkSaleWindow`, pero corta con 403 si no se puede vender.
   * Es el método que deben llamar `inventory` (al crear el hold) y `orders`
   * (al confirmar) para que la ventana de venta se respete de verdad.
   */
  async assertSaleWindowOpen(
    eventId: string,
    query: SaleWindowQuery = {},
  ): Promise<SaleWindowDecision> {
    const { decision } = await this.resolve(eventId, query);
    this.assertAllowed(eventId, decision);
    return decision;
  }

  /**
   * `assertSaleWindowOpen` + reserva del cupo de la fase (`allocationPercent`).
   *
   * ESTE MÉTODO TIENE EFECTO. Se llama en lugar de `assertSaleWindowOpen` justo
   * antes de tocar inventario (`InventoryService.createHold`), porque el cupo
   * tiene que apartarse ANTES de que las butacas queden retenidas: comprobarlo
   * al cobrar llega tarde, la preventa ya se llevó el aforo.
   *
   * Si después de esto la reserva no cuaja —asiento tomado por otro, tope de
   * sesión, transacción revertida— hay que devolver el cupo con
   * `releasePhaseQuota(decision.quota)`. Lo que NO hace falta compensar es el
   * caso normal: un hold que expira o una orden que se cancela devuelven el cupo
   * solos, porque el contador se reconcilia contra la base (ver
   * `SalePhaseQuotaService`).
   *
   * @param query.quantity boletos que se pretenden apartar.
   */
  async assertSaleWindowOpenAndReserve(
    eventId: string,
    query: SaleWindowQuery & { quantity: number },
  ): Promise<SaleWindowReservation> {
    const { decision, capacity } = await this.resolve(eventId, query);
    this.assertAllowed(eventId, decision);

    const phase = decision.phase;
    if (!phase || phase.allocationPercent == null || query.quantity <= 0) {
      return { ...decision, quota: null };
    }

    const target: PhaseQuotaTarget = {
      id: phase.id,
      eventId,
      name: phase.name,
      startsAt: phase.startsAt,
      endsAt: phase.endsAt,
      allocationPercent: phase.allocationPercent,
    };
    const quota = await this.quota.reserve(target, capacity, query.quantity);
    return { ...decision, quota };
  }

  /** Devuelve un cupo apartado que no llegó a convertirse en reserva. */
  async releasePhaseQuota(quota: PhaseQuotaHandle | null): Promise<void> {
    await this.quota.release(quota);
  }

  private assertAllowed(eventId: string, decision: SaleWindowDecision): void {
    if (decision.allowed) return;
    this.logger.warn(`Venta rechazada para ${eventId}: ${decision.reason}`);
    throw new ForbiddenException({
      message: decision.message,
      reason: decision.reason,
      nextOpensAt: decision.nextOpensAt,
    });
  }

  /**
   * Persiste el estado derivado de las fases (`SCHEDULED → ACTIVE → ENDED`).
   *
   * NO es de lo que depende la verdad: todas las lecturas derivan el estado del
   * reloj (`resolvePhaseStatus`), así que el backoffice no puede ver «programada»
   * una fase que lleva dos horas vendiendo aunque esto no corra nunca. Esto sólo
   * hace que la columna guardada cuadre, para los informes y para las consultas
   * que filtran por estado.
   *
   * Por eso no hay cron: la escritura viaja de gorra en el tráfico que ya pasa
   * por aquí —cada intento de reserva del onsale— y un candado con TTL hace de
   * limitador para que sea un solo nodo cada `STATUS_SYNC_INTERVAL_SECONDS`. Un
   * cron caído dejaría el sistema mintiendo; esto no puede, porque no es la
   * fuente de lo que se muestra.
   *
   * Son `updateMany` con guarda por estado y por fecha: idempotentes y sin
   * leer-modificar-escribir, así que dos nodos a la vez no se pisan.
   */
  async syncPhaseStatuses(
    eventId: string,
    phases: Array<{ status: SalePhaseStatus; startsAt: Date; endsAt: Date }>,
    at: Date = new Date(),
  ): Promise<void> {
    const needsWork = phases.some((phase) => resolvePhaseStatus(phase, at) !== phase.status);
    if (!needsWork) return;

    // El candado no se libera: su TTL ES el intervalo entre pasadas.
    const acquired = await this.redis.acquireLock(
      statusSyncKey(eventId),
      randomUUID(),
      STATUS_SYNC_INTERVAL_SECONDS,
    );
    // `UNAVAILABLE` (Redis caído) deja pasar: sin limitador es una escritura de
    // más, no una incorrecta. `TAKEN` significa que otro nodo ya la hizo.
    if (acquired === 'TAKEN') return;

    await this.prisma.salePhase.updateMany({
      where: {
        eventId,
        status: SalePhaseStatus.SCHEDULED,
        startsAt: { lte: at },
        endsAt: { gt: at },
      },
      data: { status: SalePhaseStatus.ACTIVE },
    });
    await this.prisma.salePhase.updateMany({
      where: {
        eventId,
        status: { in: [SalePhaseStatus.SCHEDULED, SalePhaseStatus.ACTIVE] },
        endsAt: { lte: at },
      },
      data: { status: SalePhaseStatus.ENDED },
    });
  }

  /**
   * Eventos anteriores a `SalePhase`: solo tienen `salesStartAt`/`salesEndAt`.
   * Si no hay ni eso, la venta queda abierta — este método sirve para respetar
   * lo configurado, no para inventar restricciones donde nunca las hubo.
   */
  private checkLegacyWindow(
    event: { startsAt: Date; salesStartAt: Date | null; salesEndAt: Date | null },
    at: Date,
  ): SaleWindowDecision {
    const { salesStartAt } = event;
    // Sin cierre explícito, cierra cuando arranca el evento: es la regla que el
    // asistente de alta ya validaba (la venta no puede cerrar después del show).
    const closesAt = event.salesEndAt ?? event.startsAt;

    if (!salesStartAt && !event.salesEndAt) {
      return {
        allowed: true,
        reason: 'OPEN_NO_WINDOW',
        message: 'El evento no tiene ventana de venta configurada.',
        phase: null,
        nextOpensAt: null,
        closesAt: null,
        maxPerOrder: null,
        discountPercent: null,
        complianceWarning: null,
      };
    }
    if (salesStartAt && salesStartAt > at) {
      return this.deny('NOT_STARTED', 'La venta aún no abre para este evento.', {
        nextOpensAt: salesStartAt,
      });
    }
    if (closesAt <= at) {
      return this.deny('CLOSED', 'La venta para este evento ya cerró.', { nextOpensAt: null });
    }
    return {
      allowed: true,
      reason: 'OPEN',
      message: 'Venta abierta.',
      phase: null,
      nextOpensAt: null,
      closesAt,
      maxPerOrder: null,
      discountPercent: null,
      complianceWarning: null,
    };
  }

  private deny(
    reason: SaleWindowReason,
    message: string,
    extra: { nextOpensAt: Date | null },
  ): SaleWindowDecision {
    return {
      allowed: false,
      reason,
      message,
      phase: null,
      nextOpensAt: extra.nextOpensAt,
      closesAt: null,
      maxPerOrder: null,
      discountPercent: null,
      complianceWarning: null,
    };
  }

  private toPhaseView(phase: SalePhaseRow, at: Date): SaleWindowPhaseView {
    return {
      id: phase.id,
      name: phase.name,
      kind: phase.kind,
      startsAt: phase.startsAt,
      endsAt: phase.endsAt,
      status: resolvePhaseStatus(phase, at),
      channels: phase.channels,
      maxPerOrder: phase.maxPerOrder,
      discountPercent: phase.discountPercent,
      allocationPercent: phase.allocationPercent,
      // Nunca se devuelve el código en sí: la lectura del evento es pública.
      requiresCode: Boolean(phase.code),
      priority: phase.priority,
    };
  }
}
