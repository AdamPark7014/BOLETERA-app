import { Controller, Post, Get, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { LayoutManagementService } from './layout-management.service';

export type CreateLayoutDto = {
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
};

/** Categorías de motivo para bloqueos/liberaciones administrativas. */
export type HoldReasonCategory =
  | 'CORTESIA'
  | 'PRODUCCION'
  | 'INCIDENCIA'
  | 'FRAUDE'
  | 'TECNICO'
  | 'OTRO';

export type HoldSeatsDto = {
  eventId: string;
  seatIds: string[];
  /** Motivo obligatorio (mín. 8 caracteres). Queda en la bitácora. */
  reason: string;
  category?: HoldReasonCategory;
  /**
   * Duración de la reserva en minutos (1..1440). Si no se manda, vale el TTL
   * por canal de inventario. Para retener sin caducidad, usa `/seats/block`.
   */
  durationMinutes?: number;
  sessionId?: string;
};

/** Bloqueo operativo: retira butacas de la venta hasta que alguien las libere. */
export type BlockSeatsDto = {
  eventId: string;
  seatIds: string[];
  /** Motivo obligatorio (mín. 8 caracteres). Queda en `InventoryBlock`. */
  reason: string;
  category?: HoldReasonCategory;
  /** Etiqueta operativa: "prensa", "produccion-gira", "palco-patrocinador". */
  label?: string;
};

export type UnblockSeatsDto = {
  eventId: string;
  /** Butacas a devolver a la venta; alternativa a `blockIds`. */
  seatIds?: string[];
  blockIds?: string[];
  /** Motivo obligatorio (mín. 8 caracteres). */
  reason: string;
  category?: HoldReasonCategory;
};

export type ReleaseSeatsDto = {
  seatIds: string[];
  /** Motivo obligatorio (mín. 8 caracteres). Queda en la bitácora. */
  reason: string;
  category?: HoldReasonCategory;
};

/** Roles que pueden operar inventario administrativamente. */
const INVENTORY_STAFF_ROLES = ['ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER', 'PROMOTER'] as const;

@ApiTags('Layout Management')
@Controller('layouts')
// Todas las rutas exigen sesión: antes `sightlines`, `seats/hold` y `seats/release`
// eran anónimas y escribían en base de datos e inventario.
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class LayoutManagementController {
  constructor(private layoutService: LayoutManagementService) {}

  @Post('venue/:venueId')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER', 'PROMOTER')
  @ApiOperation({ summary: 'Create venue layout with sections' })
  async createLayout(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
    @Body() data: CreateLayoutDto,
  ) {
    return await this.layoutService.createVenueLayout(venueId, data, orgId);
  }

  @Post(':layoutId/sightlines')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Calculate sightline scores' })
  async calculateSightlines(
    @Param('layoutId') layoutId: string,
    @CurrentUser() user: { sub: string; organizationId: string | null; role: string },
  ) {
    return await this.layoutService.calculateSightlineScores(layoutId, {
      userId: user.sub,
      organizationId: user.organizationId,
      role: user.role,
    });
  }

  @Post(':layoutId/seats/hold')
  @Roles(...INVENTORY_STAFF_ROLES)
  @ApiOperation({ summary: 'Bloqueo administrativo de butacas (motivo obligatorio)' })
  async holdSeats(
    @Param('layoutId') layoutId: string,
    @CurrentUser() user: { sub: string; organizationId: string | null; role: string },
    @Body() data: HoldSeatsDto,
  ) {
    return await this.layoutService.holdSeats(
      layoutId,
      data.eventId,
      data.seatIds,
      { userId: user.sub, organizationId: user.organizationId, role: user.role },
      { reason: data.reason, category: data.category },
      data.sessionId,
      data.durationMinutes,
    );
  }

  @Post(':layoutId/seats/block')
  @Roles(...INVENTORY_STAFF_ROLES)
  @ApiOperation({ summary: 'Bloqueo de inventario sin caducidad (motivo obligatorio)' })
  async blockSeats(
    @Param('layoutId') layoutId: string,
    @CurrentUser() user: { sub: string; organizationId: string | null; role: string },
    @Body() data: BlockSeatsDto,
  ) {
    return await this.layoutService.blockSeats(
      layoutId,
      data.eventId,
      data.seatIds,
      { userId: user.sub, organizationId: user.organizationId, role: user.role },
      { reason: data.reason, category: data.category },
      data.label,
    );
  }

  @Post(':layoutId/seats/unblock')
  @Roles(...INVENTORY_STAFF_ROLES)
  @ApiOperation({ summary: 'Devolver a la venta butacas bloqueadas (motivo obligatorio)' })
  async unblockSeats(
    @Param('layoutId') _layoutId: string,
    @CurrentUser() user: { sub: string; organizationId: string | null; role: string },
    @Body() data: UnblockSeatsDto,
  ) {
    return await this.layoutService.unblockSeats(
      data.eventId,
      { seatIds: data.seatIds, blockIds: data.blockIds },
      { userId: user.sub, organizationId: user.organizationId, role: user.role },
      { reason: data.reason, category: data.category },
    );
  }

  @Get('events/:eventId/blocks')
  @Roles(...INVENTORY_STAFF_ROLES)
  @ApiOperation({ summary: 'Bloqueos de inventario de un evento' })
  async listBlocks(
    @Param('eventId') eventId: string,
    @CurrentUser() user: { sub: string; organizationId: string | null; role: string },
    @Query('includeReleased') includeReleased?: string,
  ) {
    return await this.layoutService.listBlocks(
      eventId,
      { userId: user.sub, organizationId: user.organizationId, role: user.role },
      includeReleased === 'true',
    );
  }

  @Post(':layoutId/seats/release')
  @Roles(...INVENTORY_STAFF_ROLES)
  @ApiOperation({ summary: 'Liberación administrativa de holds (motivo obligatorio)' })
  async releaseSeats(
    @Param('layoutId') _layoutId: string,
    @CurrentUser() user: { sub: string; organizationId: string | null; role: string },
    @Body() data: ReleaseSeatsDto,
  ) {
    return await this.layoutService.releaseSeats(
      data.seatIds,
      { userId: user.sub, organizationId: user.organizationId, role: user.role },
      { reason: data.reason, category: data.category },
    );
  }
}


