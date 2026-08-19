import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { GuestSessionService } from './guest-session.service';
import { SalesChannel, TicketStatus } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { EventOrgAccessGuard } from '../auth/event-org-access.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { InventoryService } from './inventory.service';
import { WaitingRoomService } from './waiting-room.service';

/** Roles con derecho a operar sobre la asignación de taquilla. */
const STAFF_ROLES = ['TAQUILLA', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER'];

/** Los holds públicos se ratonean; el tope global (120/min) es demasiado laxo aquí. */
const HOLD_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

/**
 * Emisión de identidades de invitado.
 *
 * Configurable y con un techo generoso a propósito: detrás de un NAT
 * corporativo o del CGNAT de una operadora móvil, cientos de compradores
 * legítimos comparten una sola IP. Un límite estrecho aquí no frena al bot
 * —que rota proxies— y en cambio deja fuera a una oficina entera en pleno
 * onsale. El valor de este límite es dejar rastro y poner un techo, no ser la
 * defensa principal: esa es la firma, que sí es infalsificable.
 */
const SESSION_THROTTLE = {
  default: {
    limit: positiveIntEnv('GUEST_SESSION_ISSUE_LIMIT', 60),
    ttl: 60_000,
  },
};

/**
 * Lee un entero positivo del entorno.
 *
 * `Number(process.env.X ?? 60)` NO sirve: `??` solo cubre null y undefined, asi
 * que una variable definida pero VACIA da `Number('') === 0` — y un limite de 0
 * bloquea a todos los compradores con un 429 sin que nada lo delate. Un valor
 * invalido tiene que caer al valor por omision, no a cero.
 */
function positiveIntEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const AVAILABILITY_CACHE_HEADER = 'public, max-age=5, stale-while-revalidate=30';

type PublicUser = { sub?: string; email?: string; role?: string } | undefined;

@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(
    private inventory: InventoryService,
    private waitingRoom: WaitingRoomService,
    private guestSession: GuestSessionService,
  ) {}

  /**
   * Exige el pase de la sala de espera cuando el evento la tiene activa.
   *
   * Sin esto la fila sería decorativa: cualquiera que conociera el endpoint
   * apartaría butacas saltándose a las 30.000 personas que sí están esperando,
   * que es justo la injusticia que la sala existe para evitar. Los eventos sin
   * sala configurada no pagan ningún costo: `isGated` sale en falso y no se
   * consulta nada más.
   */
  private async assertQueuePass(eventId: string, pass?: string) {
    if (!(await this.waitingRoom.isGated(eventId))) return;
    if (!this.waitingRoom.verifyPass(pass, eventId)) {
      throw new ForbiddenException(
        'Este evento tiene sala de espera: entra a la fila y espera tu turno para apartar lugares.',
      );
    }
  }

  @Get(':eventId/map')
  getMap(@Param('eventId') eventId: string) {
    return this.inventory.getMap(eventId);
  }

  /**
   * Snapshot AGREGADO (F1-08). Ya NO devuelve `tickets[]`: con 45.000 butacas
   * eso era una lista completa por visor. El detalle vive en `:eventId/seats`.
   */
  @Get(':eventId/availability')
  @Header('Cache-Control', AVAILABILITY_CACHE_HEADER)
  @ApiOperation({ summary: 'Conteos agregados por estado y por offer (sin detalle por butaca)' })
  availability(@Param('eventId') eventId: string) {
    return this.inventory.getAvailability(eventId);
  }

  /** Detalle por butaca, paginado por keyset. Obligatorio paginar. */
  @Get(':eventId/seats')
  @Header('Cache-Control', AVAILABILITY_CACHE_HEADER)
  @ApiOperation({ summary: 'Detalle de butacas paginado (cursor sobre id, máx. 2000 por página)' })
  seats(
    @Param('eventId') eventId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const parsedStatus = status ? (status.toUpperCase() as TicketStatus) : undefined;
    if (parsedStatus && !Object.values(TicketStatus).includes(parsedStatus)) {
      throw new BadRequestException(`Unknown status: ${status}`);
    }
    return this.inventory.getSeatPage(eventId, {
      cursor: cursor || undefined,
      limit: limit ? Number(limit) : undefined,
      status: parsedStatus,
    });
  }

  /** SSE de deltas. Un productor por evento, compartido entre todos los suscriptores. */
  @Sse(':eventId/stream')
  stream(@Param('eventId') eventId: string) {
    return this.inventory.streamAvailability(eventId);
  }

  // ---------------------------------------------------------------------------
  // Holds públicos — canal SIEMPRE WEB (F1-13)
  // ---------------------------------------------------------------------------

  /**
   * Emite una identidad de invitado firmada.
   *
   * Es el unico sitio donde nacen, lo que la convierte en el punto estrecho
   * donde limitar y contar el acaparamiento. Va limitada por IP: pedir mil
   * identidades por minuto no es un comprador.
   */
  @Post('session')
  @Throttle(SESSION_THROTTLE)
  @ApiOperation({ summary: 'Emitir identidad de invitado firmada por el servidor' })
  issueGuestSession() {
    const session = this.guestSession.issue();
    return { sessionId: session.token, expiresAt: session.expiresAt.toISOString() };
  }

  @Post('holds/best-available')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle(HOLD_THROTTLE)
  async createBestAvailable(
    @Body()
    body: {
      eventId: string;
      offerId: string;
      quantity: number;
      sessionId?: string;
      contiguous?: boolean;
      /** Pase emitido por la sala de espera, si el evento la tiene activa. */
      queuePass?: string;
    },
    @CurrentUser() user: PublicUser,
    @Headers('x-channel') channelHeader?: string,
    @Headers('x-cashier-id') cashierHeader?: string,
  ) {
    this.assertNoChannelSpoofing(channelHeader, cashierHeader);
    const sessionId = this.requireIdentity(body?.sessionId, user);
    await this.assertQueuePass(body.eventId, body.queuePass);
    return this.inventory.createBestAvailableHold({
      eventId: body.eventId,
      offerId: body.offerId,
      quantity: body.quantity,
      contiguous: body.contiguous,
      sessionId,
      userId: user?.sub,
      channel: SalesChannel.WEB,
    });
  }

  @Post('holds')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle(HOLD_THROTTLE)
  async createHold(
    @Body()
    body: {
      eventId: string;
      seatIds?: string[];
      offerId?: string;
      quantity?: number;
      sessionId?: string;
      /** Pase emitido por la sala de espera, si el evento la tiene activa. */
      queuePass?: string;
    },
    @CurrentUser() user: PublicUser,
    @Headers('x-channel') channelHeader?: string,
    @Headers('x-cashier-id') cashierHeader?: string,
  ) {
    this.assertNoChannelSpoofing(channelHeader, cashierHeader);
    const sessionId = this.requireIdentity(body?.sessionId, user);
    // Nada de `...body`: `channel`, `cashierId` y `userId` los pone el servidor.
    await this.assertQueuePass(body.eventId, body.queuePass);
    return this.inventory.createHold({
      eventId: body.eventId,
      seatIds: body.seatIds,
      offerId: body.offerId,
      quantity: body.quantity,
      sessionId,
      userId: user?.sub,
      channel: SalesChannel.WEB,
    });
  }

  /**
   * F1-13b: liberar exige propiedad. `sessionId` viaja en el cuerpo (no en un
   * header: `X-Session-Id` no está en la lista CORS y acabaría en los logs de
   * acceso si fuera querystring).
   */
  @Delete('holds/:id')
  @UseGuards(OptionalJwtAuthGuard)
  release(
    @Param('id') id: string,
    @CurrentUser() user: PublicUser,
    @Body() body?: { sessionId?: string },
    @Headers('x-session-id') sessionHeader?: string,
  ) {
    return this.inventory.releaseHold(id, {
      sessionId: body?.sessionId ?? sessionHeader,
      userId: user?.sub,
      staff: false,
    });
  }

  // ---------------------------------------------------------------------------
  // Holds de taquilla — sólo con token y rol (F1-13)
  // ---------------------------------------------------------------------------

  /**
   * El canal decide el TTL del hold (300 s vs 900 s) y la cubeta de cuota, así
   * que no puede salir de un header: antes cualquier bot ponía
   * `x-channel: TAQUILLA` y drenaba la asignación de taquilla.
   * El `cashierId` sale del token, nunca del header.
   */
  @Post('staff/holds')
  @UseGuards(JwtAuthGuard, RolesGuard, EventOrgAccessGuard)
  @Roles(...STAFF_ROLES)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Hold en canal TAQUILLA (requiere rol de taquilla/administración)' })
  createStaffHold(
    @Body()
    body: {
      eventId: string;
      seatIds?: string[];
      offerId?: string;
      quantity?: number;
      sessionId?: string;
    },
    @CurrentUser() user: { sub: string; role?: string },
  ) {
    return this.inventory.createHold({
      eventId: body.eventId,
      seatIds: body.seatIds,
      offerId: body.offerId,
      quantity: body.quantity,
      sessionId: body.sessionId ?? `staff-${user.sub}`,
      userId: user.sub,
      channel: SalesChannel.TAQUILLA,
      cashierId: user.sub,
      skipSessionLimit: true,
    });
  }

  @Post('staff/holds/best-available')
  @UseGuards(JwtAuthGuard, RolesGuard, EventOrgAccessGuard)
  @Roles(...STAFF_ROLES)
  @ApiBearerAuth()
  createStaffBestAvailable(
    @Body()
    body: {
      eventId: string;
      offerId: string;
      quantity: number;
      sessionId?: string;
      contiguous?: boolean;
    },
    @CurrentUser() user: { sub: string; role?: string },
  ) {
    return this.inventory.createBestAvailableHold({
      eventId: body.eventId,
      offerId: body.offerId,
      quantity: body.quantity,
      contiguous: body.contiguous,
      sessionId: body.sessionId ?? `staff-${user.sub}`,
      userId: user.sub,
      channel: SalesChannel.TAQUILLA,
      cashierId: user.sub,
      skipSessionLimit: true,
    });
  }

  /** Liberación administrativa: salta la comprobación de propiedad. */
  @Delete('staff/holds/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STAFF_ROLES)
  @ApiBearerAuth()
  releaseAsStaff(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; role?: string; organizationId?: string | null },
  ) {
    // El id del hold no dice de qué organización es, así que EventOrgAccessGuard
    // no puede actuar aquí: la comprobación baja al servicio, que resuelve el
    // evento del hold y contrasta su organización con la del token.
    return this.inventory.releaseHold(id, {
      staff: true,
      staffRole: user.role,
      staffOrganizationId: user.organizationId ?? null,
    });
  }

  // ---------------------------------------------------------------------------

  /**
   * Ruta pública: el canal es WEB y punto. Fallamos en vez de degradar en
   * silencio para que cualquier cliente antiguo que aún mande el header se vea
   * de inmediato en vez de descubrirlo por un TTL raro.
   */
  private assertNoChannelSpoofing(channelHeader?: string, cashierHeader?: string) {
    const channel = channelHeader?.trim().toUpperCase();
    if (channel && channel !== SalesChannel.WEB) {
      throw new ForbiddenException(
        'x-channel no se acepta en rutas públicas. Usa /inventory/staff/holds con un token de taquilla.',
      );
    }
    if (cashierHeader?.trim()) {
      throw new ForbiddenException('x-cashier-id se toma del token, no de un header.');
    }
  }

  /** Un hold anónimo sin `sessionId` no se puede atribuir ni liberar con seguridad. */
  /**
   * Identidad con la que se contabilizan los topes por comprador.
   *
   * Antes bastaba con que el cliente mandara ALGUNA cadena, asi que el limite
   * por comprador se imponia sobre un valor que el comprador elige: un bot
   * cambiaba de `sessionId` en cada peticion y el tope desaparecia. Ahora la
   * identidad la emite y la firma el servidor (`GuestSessionService`), y una
   * firma que no cuadra se rechaza siempre.
   */
  private requireIdentity(sessionId: string | undefined, user: PublicUser): string | undefined {
    const verified = this.guestSession.verify(sessionId);
    if (!verified && !user?.sub) {
      throw new BadRequestException('sessionId is required for guest holds');
    }
    return verified?.id;
  }
}
