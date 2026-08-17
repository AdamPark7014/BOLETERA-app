import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { EventStatus, SalePhaseStatus, SalesChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
  | 'EVENT_NOT_FOUND';

export type SaleWindowPhaseView = {
  id: string;
  name: string;
  kind: string;
  startsAt: Date;
  endsAt: Date;
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
};

export type SaleWindowQuery = {
  /** Instante a evaluar. Por defecto, ahora. Útil para simular en el alta. */
  at?: Date;
  /** Canal por el que se intenta vender. Sin canal no se filtra por canal. */
  channel?: SalesChannel;
  /** Código de acceso presentado por el comprador (presales, socios). */
  code?: string;
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

  constructor(private prisma: PrismaService) {}

  /**
   * Resuelve la ventana de venta sin lanzar. Devuelve siempre una decisión
   * explicada: quien la consulta decide si corta o solo informa.
   */
  async checkSaleWindow(eventId: string, query: SaleWindowQuery = {}): Promise<SaleWindowDecision> {
    const at = query.at ?? new Date();

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        status: true,
        startsAt: true,
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
      return this.deny('EVENT_NOT_FOUND', 'El evento no existe.', { nextOpensAt: null });
    }

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
        phase: this.toPhaseView(phase),
        nextOpensAt,
        closesAt: phase.endsAt,
        maxPerOrder: phase.maxPerOrder,
        discountPercent: phase.discountPercent,
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
    const decision = await this.checkSaleWindow(eventId, query);
    if (!decision.allowed) {
      this.logger.warn(`Venta rechazada para ${eventId}: ${decision.reason}`);
      throw new ForbiddenException({
        message: decision.message,
        reason: decision.reason,
        nextOpensAt: decision.nextOpensAt,
      });
    }
    return decision;
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
    };
  }

  private toPhaseView(phase: {
    id: string;
    name: string;
    kind: string;
    startsAt: Date;
    endsAt: Date;
    channels: SalesChannel[];
    maxPerOrder: number | null;
    discountPercent: number | null;
    allocationPercent: number | null;
    code: string | null;
    priority: number;
  }): SaleWindowPhaseView {
    return {
      id: phase.id,
      name: phase.name,
      kind: phase.kind,
      startsAt: phase.startsAt,
      endsAt: phase.endsAt,
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
