import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { GuestSessionService } from './guest-session.service';
import { WaitingRoomService } from './waiting-room.service';

const JOIN_LIMIT = Number(process.env.WAITING_ROOM_JOIN_LIMIT) || 10;
const STATUS_LIMIT = Number(process.env.WAITING_ROOM_STATUS_LIMIT) || 120;

type PublicUser = { sub?: string } | undefined;

/**
 * Sala de espera. El memberId ya no lo inventa el cliente: es el id de la
 * sesión de invitado firmada o el `sub` de la cuenta.
 */
@ApiTags('Waiting Room')
@Controller('waiting-room')
export class WaitingRoomController {
  constructor(
    private readonly waitingRoom: WaitingRoomService,
    private readonly guestSession: GuestSessionService
  ) {}

  @Get(':eventId')
  @Header('Cache-Control', 'public, max-age=10')
  @ApiOperation({ summary: 'Waiting-room configuration for an event (public)' })
  async config(@Param('eventId') eventId: string) {
    const config = await this.waitingRoom.configFor(eventId);
    return config ? { enabled: true, opensAt: config.opensAt } : { enabled: false as const };
  }

  @Post(':eventId/join')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: JOIN_LIMIT, ttl: 60_000 } })
  @ApiOperation({ summary: 'Join the queue (idempotent: rejoining keeps your place)' })
  async join(
    @Param('eventId') eventId: string,
    @Body() body: { sessionId?: string; memberId?: string },
    @CurrentUser() user: PublicUser
  ) {
    const memberId = this.requireMember(body?.sessionId ?? body?.memberId, user);
    return this.waitingRoom.join(eventId, memberId);
  }

  @Get(':eventId/status')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: STATUS_LIMIT, ttl: 60_000 } })
  @ApiOperation({ summary: 'Current position, estimated wait and admission pass' })
  async status(
    @Param('eventId') eventId: string,
    @CurrentUser() user: PublicUser,
    @Query('sessionId') sessionId?: string,
    @Query('memberId') memberId?: string
  ) {
    const id = this.requireMember(sessionId ?? memberId, user);
    return this.waitingRoom.status(eventId, id);
  }

  @Delete(':eventId')
  @UseGuards(OptionalJwtAuthGuard)
  async leave(
    @Param('eventId') eventId: string,
    @CurrentUser() user: PublicUser,
    @Query('sessionId') sessionId?: string,
    @Query('memberId') memberId?: string
  ) {
    const id = this.requireMember(sessionId ?? memberId, user);
    await this.waitingRoom.leave(eventId, id);
    return { left: true };
  }

  private requireMember(raw: string | undefined, user: PublicUser): string {
    if (user?.sub) return user.sub;
    const verified = this.guestSession.verify(raw);
    if (verified?.id) return verified.id;
    // Compat: memberId opaco viejo solo si STRICT está apagado y parece id corto.
    const trimmed = raw?.trim();
    if (trimmed && !trimmed.includes('.') && trimmed.length <= 100) {
      if (process.env.GUEST_SESSION_STRICT === 'true') {
        throw new BadRequestException(
          'Necesitas una sesión de comprador firmada para entrar a la fila.'
        );
      }
      return trimmed;
    }
    throw new BadRequestException(
      'Necesitas iniciar sesión o pedir una sesión de invitado para entrar a la fila.'
    );
  }
}
