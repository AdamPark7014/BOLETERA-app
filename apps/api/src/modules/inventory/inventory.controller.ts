import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { GuestSessionService } from './guest-session.service';
import { SalesChannel, TicketStatus } from '@prisma/client';
import { parseSalesChannel } from '../../common/sales-channel';
import { AuditService } from '../../common/audit.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { EventOrgAccessGuard } from '../auth/event-org-access.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BuyerRiskService } from './buyer-risk.service';
import { HumanChallengeService } from './human-challenge.service';
import { clientIp } from '../../common/client-ip';
import { InventoryService } from './inventory.service';
import { WaitingRoomService } from './waiting-room.service';
import type { Request } from 'express';

/** Roles con derecho a operar holds de canal staff (taquilla, cortesía, etc.). */
const STAFF_ROLES = [
  'TAQUILLA',
  'TAQUILLA_SUPERVISOR',
  'TAQUILLA_ADMIN',
  'PROMOTER',
  'ADMIN',
  'SUPER_ADMIN',
  'VENUE_MANAGER',
];

/** Los holds públicos se ratonean; el tope global (120/min) es demasiado laxo aquí. */
const HOLD_THROTTLE = {
  default: {
    limit: positiveIntEnv('HOLD_THROTTLE_LIMIT', 30),
    ttl: 60_000,
  },
};

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
    private risk: BuyerRiskService,
    private challenge: HumanChallengeService,
    private audit: AuditService
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
  private async assertQueuePass(eventId: string, pass: string | undefined, memberId: string) {
    if (await this.waitingRoom.isSaleClosed(eventId)) {
      throw new ForbiddenException('La venta de este evento está cerrada por el organizador.');
    }
    if (!(await this.waitingRoom.isGated(eventId))) return;
    if (!this.waitingRoom.verifyPass(pass, eventId, memberId)) {
      throw new ForbiddenException(
        'Este evento tiene sala de espera: entra a la fila con tu sesión y espera tu turno para apartar lugares.'
      );
    }
  }

  private async assertHumanOrChallenge(
    req: Request,
    subject: string,
    clearanceToken: string | undefined,
    eventId: string
  ) {
    if (this.challenge.verifyClearance(clearanceToken, subject, eventId)) return;
    const ip = clientIp(req);
    const ua = String(req.headers['user-agent'] || '');
    const assessment = await this.risk.assess({ ip, userAgent: ua, sessionId: subject, eventId });
    if (assessment.level !== 'high') return;
    await this.audit
      .log({
        action: 'BUYER_RISK_CHALLENGE',
        entityType: 'Event',
        entityId: eventId,
        metadata: { score: assessment.score, reasons: assessment.reasons, ip },
      })
      .catch(() => undefined);
    const challenge = await this.challenge.issue(subject, eventId);
    throw new HttpException(
      {
        statusCode: 428,
        code: 'HUMAN_CHALLENGE_REQUIRED',
        message: 'Confirma que eres una persona para continuar.',
        challenge,
        reasons: assessment.reasons,
      },
      428 as HttpStatus
    );
  }

  /** Sujeto del reto: solo sesión de invitado verificada o id de cuenta. */
  private requireBuyerSubject(sessionId: string | undefined, user: PublicUser): string {
    const verified = this.guestSession.verify(sessionId);
    if (verified?.id) return verified.id;
    if (user?.sub) return user.sub;
    throw new BadRequestException(
      'Se necesita una sesión de invitado o una cuenta para continuar.'
    );
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
    @Query('status') status?: string
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
  @Post('challenge/solve')
  @Throttle(HOLD_THROTTLE)
  @ApiOperation({ summary: 'Resolver reto antibots y emitir pase corto' })
  async solveChallenge(
    @Body()
    body: {
      sessionId?: string;
      challengeId?: string;
      counter?: string;
      turnstileToken?: string;
      eventId?: string;
    },
    @Req() req: Request
  ) {
    const verified = this.guestSession.verify(body?.sessionId);
    if (!verified?.id) {
      throw new BadRequestException('Se necesita una sesión de invitado válida.');
    }
    const subject = verified.id;
    const ip = clientIp(req);

    if (this.challenge.provider() === 'turnstile') {
      const ok = await this.challenge.verifyTurnstile(body?.turnstileToken || '', ip);
      if (!ok) throw new BadRequestException('No se pudo confirmar el reto.');
      if (!body?.eventId) {
        throw new BadRequestException('Falta eventId para emitir el pase.');
      }
      return this.challenge.issueClearance(subject, body.eventId);
    }

    if (!body?.challengeId || body.counter == null || body.counter === '') {
      throw new BadRequestException('Faltan challengeId y counter del reto.');
    }
    const record = await this.challenge.verify(body.challengeId, String(body.counter), subject);
    return this.challenge.issueClearance(subject, record.eventId);
  }

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
    @Req() req: Request,
    @Body()
    body: {
      eventId: string;
      offerId: string;
      quantity: number;
      sessionId?: string;
      contiguous?: boolean;
      queuePass?: string;
      clearanceToken?: string;
      accessCode?: string;
    },
    @CurrentUser() user: PublicUser,
    @Headers('x-channel') channelHeader?: string,
    @Headers('x-cashier-id') cashierHeader?: string,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    this.assertNoChannelSpoofing(channelHeader, cashierHeader);
    const sessionId = this.requireIdentity(body?.sessionId, user);
    const subject = this.requireBuyerSubject(body?.sessionId, user);
    await this.assertHumanOrChallenge(req, subject, body.clearanceToken, body.eventId);
    await this.assertQueuePass(body.eventId, body.queuePass, sessionId);
    const result = await this.inventory.createBestAvailableHold({
      eventId: body.eventId,
      offerId: body.offerId,
      quantity: body.quantity,
      contiguous: body.contiguous,
      sessionId,
      userId: user?.sub,
      channel: SalesChannel.WEB,
      idempotencyKey,
      accessCode: body.accessCode,
    });
    if (body.queuePass && (await this.waitingRoom.isGated(body.eventId))) {
      await this.inventory.markHoldsQueuePass(
        result.holds.map((h) => h.id),
        Math.ceil((result.expiresAt.getTime() - Date.now()) / 1000)
      );
    }
    return result;
  }

  @Post('holds')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle(HOLD_THROTTLE)
  async createHold(
    @Req() req: Request,
    @Body()
    body: {
      eventId: string;
      seatIds?: string[];
      offerId?: string;
      quantity?: number;
      sessionId?: string;
      queuePass?: string;
      clearanceToken?: string;
      accessCode?: string;
    },
    @CurrentUser() user: PublicUser,
    @Headers('x-channel') channelHeader?: string,
    @Headers('x-cashier-id') cashierHeader?: string,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    this.assertNoChannelSpoofing(channelHeader, cashierHeader);
    const sessionId = this.requireIdentity(body?.sessionId, user);
    const subject = this.requireBuyerSubject(body?.sessionId, user);
    await this.assertHumanOrChallenge(req, subject, body.clearanceToken, body.eventId);
    await this.assertQueuePass(body.eventId, body.queuePass, sessionId);
    const result = await this.inventory.createHold({
      eventId: body.eventId,
      seatIds: body.seatIds,
      offerId: body.offerId,
      quantity: body.quantity,
      sessionId,
      userId: user?.sub,
      channel: SalesChannel.WEB,
      idempotencyKey,
      accessCode: body.accessCode,
    });
    if (body.queuePass && (await this.waitingRoom.isGated(body.eventId))) {
      await this.inventory.markHoldsQueuePass(
        result.holds.map((h) => h.id),
        Math.ceil((result.expiresAt.getTime() - Date.now()) / 1000)
      );
    }
    return result;
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
    @Headers('x-session-id') sessionHeader?: string
  ) {
    // El hold guarda el id VERIFICADO de la identidad firmada (requireIdentity),
    // no la cadena firmada completa: comparar contra la cadena cruda respondía
    // 403 «Hold belongs to another session» a su propio dueño, el comprador no
    // podía soltar asientos y chocaba con el tope de 10 apartados.
    const rawSession = body?.sessionId ?? sessionHeader;
    return this.inventory.releaseHold(id, {
      sessionId: this.guestSession.verify(rawSession)?.id,
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
  @ApiOperation({ summary: 'Hold en canal staff (taquilla, cortesía, promotor, etc.)' })
  createStaffHold(
    @Body()
    body: {
      eventId: string;
      seatIds?: string[];
      offerId?: string;
      quantity?: number;
      sessionId?: string;
      channel?: string;
    },
    @CurrentUser() user: { sub: string; role?: string },
    @Headers('x-channel') channelHeader?: string,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    const channel = parseSalesChannel(body.channel ?? channelHeader) ?? SalesChannel.TAQUILLA;
    return this.inventory.createHold({
      eventId: body.eventId,
      seatIds: body.seatIds,
      offerId: body.offerId,
      quantity: body.quantity,
      sessionId: body.sessionId ?? `staff-${user.sub}`,
      userId: user.sub,
      channel,
      cashierId: user.sub,
      skipSessionLimit: true,
      idempotencyKey,
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
      channel?: string;
    },
    @CurrentUser() user: { sub: string; role?: string },
    @Headers('x-channel') channelHeader?: string
  ) {
    const channel = parseSalesChannel(body.channel ?? channelHeader) ?? SalesChannel.TAQUILLA;
    return this.inventory.createBestAvailableHold({
      eventId: body.eventId,
      offerId: body.offerId,
      quantity: body.quantity,
      contiguous: body.contiguous,
      sessionId: body.sessionId ?? `staff-${user.sub}`,
      userId: user.sub,
      channel,
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
    @CurrentUser() user: { sub: string; role?: string; organizationId?: string | null }
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
        'x-channel no se acepta en rutas públicas. Usa /inventory/staff/holds con un token de taquilla.'
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
