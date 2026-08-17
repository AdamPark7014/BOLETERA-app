import {
  BadRequestException,
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
   * Bloqueo administrativo de butacas (cortesías, producción, incidencias).
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
  ) {
    const reasoned = this.assertReason(action);
    const event = await this.assertEventInOrg(eventId, operator);

    if (!Array.isArray(seatIds) || seatIds.length === 0) {
      throw new BadRequestException('seatIds es obligatorio');
    }

    const hold = await this.inventory.createHold({
      eventId,
      seatIds,
      sessionId: sessionId ?? `admin-${operator.userId}`,
      channel: SalesChannel.TAQUILLA,
      cashierId: operator.userId,
      skipSessionLimit: true,
    });

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
      },
    });

    this.logger.log(
      `Admin hold: ${seatIds.length} butacas en ${eventId} por ${operator.userId} — ${reasoned.category}`,
    );
    return { ...hold, reason: reasoned.reason, category: reasoned.category };
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


