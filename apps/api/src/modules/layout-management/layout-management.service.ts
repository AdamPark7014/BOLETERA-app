import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SalesChannel } from '@prisma/client';
import type { SeatMapData } from '@boletera/shared';
import {
  calculateSightlines,
  normalizeSeatMap,
  resolveGeometry,
} from '@boletera/venue-engine';
import { PrismaService } from '../prisma/prisma.service';
import { VenueLayoutService } from '../venue-layout/venue-layout.service';
import { InventoryService } from '../inventory/inventory.service';
import { AuditService } from '../../common/audit.service';

/** Contexto del operador que ejecuta una acción administrativa sobre inventario. */
export type OperatorContext = {
  userId: string;
  organizationId: string | null;
  role: string;
};

/** Motivo obligatorio en bloqueos/liberaciones administrativas. */
export type ReasonedAction = {
  /** Texto libre obligatorio: queda en la bitácora de auditoría. */
  reason: string;
  /** Categoría opcional para poder agrupar en reportes. */
  category?: 'CORTESIA' | 'PRODUCCION' | 'INCIDENCIA' | 'FRAUDE' | 'TECNICO' | 'OTRO';
};

const MIN_REASON_LENGTH = 8;

/**
 * Tope de una reserva temporal. Más allá de un día ya no es una reserva: es un
 * bloqueo de inventario y tiene su propia vía (`blockSeats`), que no caduca.
 */
const MAX_HOLD_MINUTES = 24 * 60;

@Injectable()
export class LayoutManagementService {
  private logger = new Logger(LayoutManagementService.name);

  constructor(
    private prisma: PrismaService,
    private venueLayout: VenueLayoutService,
    private inventory: InventoryService,
    private audit: AuditService,
  ) {}

  /**
   * Valida el motivo obligatorio. Sin motivo no hay bloqueo ni liberación:
   * una butaca que desaparece del inventario sin rastro es un agujero de auditoría.
   */
  private assertReason(action: ReasonedAction | undefined): ReasonedAction {
    const reason = action?.reason?.trim();
    if (!reason || reason.length < MIN_REASON_LENGTH) {
      throw new BadRequestException(
        `El motivo es obligatorio y debe tener al menos ${MIN_REASON_LENGTH} caracteres.`,
      );
    }
    return { reason, category: action?.category ?? 'OTRO' };
  }

  /**
   * Comprueba que el layout pertenece a un venue de la organización del operador.
   * SUPER_ADMIN puede cruzar tenants; el resto no.
   */
  private async assertLayoutInOrg(layoutId: string, operator: OperatorContext) {
    const layout = await this.prisma.venueLayout.findUnique({
      where: { id: layoutId },
      select: { id: true, venue: { select: { id: true, organizationId: true } } },
    });
    if (!layout) throw new NotFoundException('Layout not found');
    if (operator.role === 'SUPER_ADMIN') return layout;
    if (!operator.organizationId || layout.venue?.organizationId !== operator.organizationId) {
      throw new ForbiddenException('Organization access denied');
    }
    return layout;
  }

  /** Comprueba que el evento pertenece a la organización del operador. */
  private async assertEventInOrg(eventId: string, operator: OperatorContext) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, organizationId: true },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (operator.role === 'SUPER_ADMIN') return event;
    if (!operator.organizationId || event.organizationId !== operator.organizationId) {
      throw new ForbiddenException('Organization access denied');
    }
    return event;
  }

  async createVenueLayout(
    venueId: string,
    data: {
      name: string;
      totalCapacity: number;
      sections: Array<{
        sectionId: string;
        name: string;
        capacity: number;
        type?: string;
        rows?: number;
        seatsPerRow?: number;
      }>;
    },
    organizationId: string,
  ) {
    const mapData: SeatMapData = {
      viewport: { width: 800, height: 500 },
      sections: data.sections.map((sec, si) => {
        const seatsPerRow = sec.seatsPerRow ?? 10;
        const rows = sec.rows ?? Math.ceil(sec.capacity / seatsPerRow);
        const seats = [];
        let count = 0;
        for (let r = 0; r < rows && count < sec.capacity; r++) {
          for (let s = 1; s <= seatsPerRow && count < sec.capacity; s++) {
            const label = `${String.fromCharCode(65 + r)}-${s}`;
            seats.push({
              id: `seat-${sec.sectionId}-${r}-${s}`,
              label,
              row: String.fromCharCode(65 + r),
              x: 40 + s * 34,
              y: 80 + r * 32 + si * 120,
              tier: sec.type === 'vip' ? 'premium' : sec.type === 'accessible' ? 'standard' : 'standard',
            });
            count++;
          }
        }
        return {
          id: sec.sectionId,
          name: sec.name,
          slug: sec.sectionId,
          color: '#737373',
          seats,
        };
      }),
    };

    return this.venueLayout.saveMap(venueId, organizationId, mapData);
  }

  async calculateSightlineScores(layoutId: string, operator: OperatorContext) {
    // El cálculo reescribe Seat.viewQuality y VenueLayout.mapData: exige tenant válido.
    await this.assertLayoutInOrg(layoutId, operator);

    const layout = await this.prisma.venueLayout.findUnique({
      where: { id: layoutId },
      include: { sections: { include: { seats: true } } },
    });
    if (!layout) throw new BadRequestException('Layout not found');

    const map = normalizeSeatMap(layout.mapData);
    const scene = resolveGeometry(map);
    const result = calculateSightlines(scene);
    const byId = new Map(result.scores.map((s) => [s.seatId, s]));

    let updated = 0;
    for (const sec of layout.sections) {
      for (const seat of sec.seats) {
        const hit = byId.get(seat.id);
        if (!hit) continue;
        const prev = (seat.coord3d as Record<string, unknown> | null) ?? {};
        await this.prisma.seat.update({
          where: { id: seat.id },
          data: {
            viewQuality: hit.score,
            coord3d: {
              ...prev,
              x: typeof prev.x === 'number' ? prev.x : seat.x,
              y: typeof prev.y === 'number' ? prev.y : 0,
              z: typeof prev.z === 'number' ? prev.z : seat.y,
              visibility: hit.visibility,
              sightline: {
                score: hit.score,
                grade: hit.grade,
                occluded: hit.occluded,
              },
            } as unknown as Prisma.InputJsonValue,
          },
        });
        updated += 1;
      }
    }

    // Keep mapData.venue + seat visibility in sync for editor/publish
    const nextSections = map.sections.map((sec) => ({
      ...sec,
      seats: sec.seats.map((seat) => {
        const hit = byId.get(seat.id);
        if (!hit || seat.visibility?.blocked) return seat;
        return {
          ...seat,
          visibility: hit.visibility,
          metadata: {
            ...(seat.metadata ?? {}),
            sightline: { score: hit.score, grade: hit.grade, occluded: hit.occluded },
          },
        };
      }),
    }));
    await this.prisma.venueLayout.update({
      where: { id: layoutId },
      data: {
        mapData: { ...map, version: 3, sections: nextSections } as object,
      },
    });

    this.logger.log(`Sightlines scored for layout ${layoutId}: ${updated} seats`);
    return {
      layoutId,
      seatsScored: updated,
      summary: result.summary,
      stageTarget: result.stageTarget,
      source: 'VenueGeometryEngine',
      note: 'Sightlines from distance, facing, elevation, and obstacle occlusion',
    };
  }

  /**
   * Reserva temporal de butacas por parte de un operador (apartar mientras se
   * cierra una venta por teléfono, revisar una incidencia). CADUCA sola.
   *
   * Para retener producción o prensa durante una temporada esto no sirve: eso es
   * `blockSeats`, que no caduca.
   *
   * Antes esta ruta era anónima y creaba holds de canal WEB para cualquier evento.
   * Ahora exige operador autenticado de la organización dueña del evento, motivo
   * obligatorio y deja rastro en la bitácora.
   */
  async holdSeats(
    _layoutId: string,
    eventId: string,
    seatIds: string[],
    operator: OperatorContext,
    action: ReasonedAction,
    sessionId?: string,
    durationMinutes?: number,
  ) {
    const reasoned = this.assertReason(action);
    const event = await this.assertEventInOrg(eventId, operator);

    if (!Array.isArray(seatIds) || seatIds.length === 0) {
      throw new BadRequestException('seatIds es obligatorio');
    }
    if (durationMinutes != null) {
      if (!Number.isFinite(durationMinutes) || durationMinutes < 1) {
        throw new BadRequestException('durationMinutes debe ser al menos 1');
      }
      if (durationMinutes > MAX_HOLD_MINUTES) {
        throw new BadRequestException(
          `durationMinutes no puede pasar de ${MAX_HOLD_MINUTES} (un día). Para retener inventario sin caducidad usa /seats/block.`,
        );
      }
    }

    const hold = await this.inventory.createHold({
      eventId,
      seatIds,
      sessionId: sessionId ?? `admin-${operator.userId}`,
      channel: SalesChannel.TAQUILLA,
      cashierId: operator.userId,
      skipSessionLimit: true,
    });

    // `inventory.createHold` fija el TTL por canal y no acepta uno a medida, así
    // que la duración pedida se aplica aquí, sobre los holds recién creados. El
    // candado de Redis conserva el TTL corto: si otro comprador lo toma después,
    // el CAS sobre el boleto (que sigue en HELD) lo rechaza igual.
    let expiresAt = hold.expiresAt;
    if (durationMinutes != null) {
      expiresAt = new Date(Date.now() + durationMinutes * 60_000);
      await this.prisma.seatHold.updateMany({
        where: { id: { in: hold.holds.map((h) => h.id) } },
        data: { expiresAt },
      });
    }

    await this.audit.log({
      action: 'INVENTORY_ADMIN_HOLD',
      entityType: 'Event',
      entityId: eventId,
      organizationId: event.organizationId ?? operator.organizationId ?? undefined,
      userId: operator.userId,
      metadata: {
        seatIds,
        seatCount: seatIds.length,
        reason: reasoned.reason,
        category: reasoned.category,
        eventTitle: event.title,
        durationMinutes: durationMinutes ?? null,
        expiresAt: expiresAt.toISOString(),
      },
    });

    this.logger.log(
      `Admin hold: ${seatIds.length} butacas en ${eventId} por ${operator.userId} — ${reasoned.category}`,
    );
    return { ...hold, expiresAt, reason: reasoned.reason, category: reasoned.category };
  }

  // ---------------------------------------------------------------------------
  // Bloqueo operativo de inventario (sin caducidad)
  // ---------------------------------------------------------------------------

  /**
   * Retira butacas de la venta hasta nueva orden: producción, prensa, palcos de
   * patrocinador, butacas rotas.
   *
   * El boleto pasa a `BLOCKED`, con lo que toda consulta de disponibilidad —que
   * filtra por `AVAILABLE`— deja de verlo sin que inventario cambie una línea.
   * El motivo y el rastro (quién, cuándo, por qué) viven en `InventoryBlock`.
   */
  async blockSeats(
    layoutId: string,
    eventId: string,
    seatIds: string[],
    operator: OperatorContext,
    action: ReasonedAction,
    label?: string,
  ) {
    const reasoned = this.assertReason(action);
    await this.assertLayoutInOrg(layoutId, operator);
    const event = await this.assertEventInOrg(eventId, operator);

    if (!Array.isArray(seatIds) || seatIds.length === 0) {
      throw new BadRequestException('seatIds es obligatorio');
    }
    const unique = [...new Set(seatIds)];

    // Todo o nada: un bloqueo a medias deja al operador creyendo que apartó una
    // fila entera cuando en realidad vendió la mitad.
    const blocks = await this.prisma.$transaction(async (tx) => {
      const created = [];
      for (const seatId of unique) {
        // CAS de un solo viaje: solo se bloquea lo que estaba realmente libre.
        const claimed = await tx.$queryRaw<Array<{ id: string }>>`
          UPDATE "Ticket"
             SET status = 'BLOCKED'::"TicketStatus", "updatedAt" = now()
           WHERE id = (
             SELECT id FROM "Ticket"
              WHERE "eventId" = ${eventId}
                AND "seatId" = ${seatId}
                AND status = 'AVAILABLE'::"TicketStatus"
              ORDER BY id
              LIMIT 1
           )
             AND status = 'AVAILABLE'::"TicketStatus"
          RETURNING id`;

        if (!claimed.length) {
          throw new ConflictException(
            `La butaca ${seatId} no está disponible (vendida, reservada o ya bloqueada).`,
          );
        }

        created.push(
          await tx.inventoryBlock.create({
            data: {
              eventId,
              ticketId: claimed[0].id,
              seatId,
              reason: reasoned.reason,
              category: reasoned.category ?? 'OTRO',
              label: label?.trim() || null,
              blockedBy: operator.userId,
            },
          }),
        );
      }
      return created;
    });

    await this.audit.log({
      action: 'INVENTORY_BLOCK',
      entityType: 'Event',
      entityId: eventId,
      organizationId: event.organizationId ?? operator.organizationId ?? undefined,
      userId: operator.userId,
      metadata: {
        seatIds: unique,
        seatCount: unique.length,
        blockIds: blocks.map((b) => b.id),
        reason: reasoned.reason,
        category: reasoned.category,
        label: label ?? null,
        eventTitle: event.title,
      },
    });

    this.logger.log(
      `Inventory block: ${unique.length} butacas en ${eventId} por ${operator.userId} — ${reasoned.category}`,
    );
    return { eventId, blocked: blocks.length, blocks, reason: reasoned.reason, category: reasoned.category };
  }

  /**
   * Devuelve butacas bloqueadas a la venta. Es la única salida de un bloqueo:
   * nada lo libera por tiempo. Exige motivo igual que el bloqueo.
   */
  async unblockSeats(
    eventId: string,
    selector: { seatIds?: string[]; blockIds?: string[] },
    operator: OperatorContext,
    action: ReasonedAction,
  ) {
    const reasoned = this.assertReason(action);
    const event = await this.assertEventInOrg(eventId, operator);

    const hasSeats = Array.isArray(selector.seatIds) && selector.seatIds.length > 0;
    const hasBlocks = Array.isArray(selector.blockIds) && selector.blockIds.length > 0;
    if (!hasSeats && !hasBlocks) {
      throw new BadRequestException('seatIds o blockIds es obligatorio');
    }

    const targets = await this.prisma.inventoryBlock.findMany({
      where: {
        eventId,
        releasedAt: null,
        ...(hasBlocks ? { id: { in: selector.blockIds } } : {}),
        ...(hasSeats ? { seatId: { in: selector.seatIds } } : {}),
      },
      select: { id: true, ticketId: true, seatId: true },
    });

    const releasedAt = new Date();
    /** Bloqueos cuyo boleto ya no estaba en BLOCKED: se cierran, pero se avisa. */
    const mismatched: string[] = [];

    for (const block of targets) {
      const restored = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          UPDATE "Ticket"
             SET status = 'AVAILABLE'::"TicketStatus", "updatedAt" = now()
           WHERE id = ${block.ticketId}
             AND status = 'BLOCKED'::"TicketStatus"
          RETURNING id`;
        await tx.inventoryBlock.update({
          where: { id: block.id },
          data: {
            releasedAt,
            releasedBy: operator.userId,
            releaseReason: reasoned.reason,
          },
        });
        return rows.length > 0;
      });
      if (!restored) mismatched.push(block.id);
    }

    await this.audit.log({
      action: 'INVENTORY_UNBLOCK',
      entityType: 'Event',
      entityId: eventId,
      organizationId: event.organizationId ?? operator.organizationId ?? undefined,
      userId: operator.userId,
      metadata: {
        requestedSeatIds: selector.seatIds ?? null,
        requestedBlockIds: selector.blockIds ?? null,
        released: targets.length - mismatched.length,
        closedWithoutRestore: mismatched,
        reason: reasoned.reason,
        category: reasoned.category,
        eventTitle: event.title,
      },
    });

    this.logger.log(
      `Inventory unblock: ${targets.length - mismatched.length}/${targets.length} butacas en ${eventId} por ${operator.userId}`,
    );

    return {
      eventId,
      requested: targets.length,
      released: targets.length - mismatched.length,
      /** El bloqueo se cerró pero el boleto ya no estaba bloqueado (revisar). */
      closedWithoutRestore: mismatched,
      reason: reasoned.reason,
      category: reasoned.category,
    };
  }

  /** Bloqueos de un evento. Por defecto solo los vigentes. */
  async listBlocks(eventId: string, operator: OperatorContext, includeReleased = false) {
    await this.assertEventInOrg(eventId, operator);
    const blocks = await this.prisma.inventoryBlock.findMany({
      where: { eventId, ...(includeReleased ? {} : { releasedAt: null }) },
      orderBy: { createdAt: 'desc' },
      include: { seat: { select: { id: true, label: true, sectionId: true } } },
    });
    return {
      eventId,
      total: blocks.length,
      active: blocks.filter((b) => !b.releasedAt).length,
      blocks,
    };
  }

  /**
   * Liberación administrativa (kill) de holds activos.
   *
   * Ruta antes anónima: cualquiera podía liberar los holds de otros compradores
   * durante un onsale. Ahora exige operador de la organización dueña del evento
   * de cada butaca, motivo obligatorio y registro de auditoría por lote.
   */
  async releaseSeats(seatIds: string[], operator: OperatorContext, action: ReasonedAction) {
    const reasoned = this.assertReason(action);

    if (!Array.isArray(seatIds) || seatIds.length === 0) {
      throw new BadRequestException('seatIds es obligatorio');
    }

    const holds = await this.prisma.seatHold.findMany({
      where: { seatId: { in: seatIds }, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, seatId: true, eventId: true },
    });

    // Un solo lote puede tocar varios eventos: se valida el tenant de todos antes
    // de liberar nada, para que la operación sea todo-o-nada respecto a permisos.
    const eventIds = [...new Set(holds.map((h) => h.eventId).filter(Boolean))] as string[];
    for (const eventId of eventIds) {
      await this.assertEventInOrg(eventId, operator);
    }

    // Solo el hold más reciente por butaca (findMany devuelve todos los activos).
    const seen = new Set<string>();
    const targets = holds.filter((h) => {
      if (!h.seatId || seen.has(h.seatId)) return false;
      seen.add(h.seatId);
      return true;
    });

    let released = 0;
    const failed: string[] = [];
    for (const hold of targets) {
      const result = await this.inventory.releaseHold(hold.id, { staff: true });
      if (result?.released) released += 1;
      else failed.push(hold.seatId as string);
    }

    await this.audit.log({
      action: 'INVENTORY_ADMIN_RELEASE',
      entityType: 'SeatHold',
      organizationId: operator.organizationId ?? undefined,
      userId: operator.userId,
      metadata: {
        requestedSeatIds: seatIds,
        requested: seatIds.length,
        released,
        notActive: seatIds.length - targets.length,
        failed,
        eventIds,
        reason: reasoned.reason,
        category: reasoned.category,
      },
    });

    this.logger.log(
      `Admin release: ${released}/${seatIds.length} butacas por ${operator.userId} — ${reasoned.category}`,
    );

    return {
      requested: seatIds.length,
      released,
      /** Butacas pedidas que no tenían hold activo (no es un error). */
      notActive: seatIds.length - targets.length,
      failed,
      reason: reasoned.reason,
      category: reasoned.category,
    };
  }
}


