import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { WaitingRoomService } from './waiting-room.service';

/**
 * Tope de entradas a la fila por IP.
 *
 * Protege de que un bot cree miles de identidades y desplace a la gente real,
 * pero se puede subir por entorno: detrás de un NAT corporativo o de una
 * operadora móvil, cientos de personas legítimas comparten IP, y en pruebas de
 * carga el límite es justamente lo que estorba.
 */
const JOIN_LIMIT = Number(process.env.WAITING_ROOM_JOIN_LIMIT) || 10;
const STATUS_LIMIT = Number(process.env.WAITING_ROOM_STATUS_LIMIT) || 120;

/**
 * Sala de espera.
 *
 * Las rutas son públicas a propósito: la fila existe justo para la gente que
 * todavía no ha hecho nada, y exigir sesión para poder esperar convertiría el
 * registro en un cuello de botella en el peor momento posible. La identidad es
 * el `memberId` que el navegador guarda, igual que el `sessionId` de los holds.
 */
@ApiTags('Waiting Room')
@Controller('waiting-room')
export class WaitingRoomController {
  constructor(private readonly waitingRoom: WaitingRoomService) {}

  /** Estado de la sala, para que el front sepa si debe mostrarla. */
  @Get(':eventId')
  @Header('Cache-Control', 'public, max-age=10')
  @ApiOperation({ summary: 'Waiting-room configuration for an event (public)' })
  async config(@Param('eventId') eventId: string) {
    const config = await this.waitingRoom.configFor(eventId);
    return config
      ? { enabled: true, opensAt: config.opensAt }
      : { enabled: false as const };
  }

  @Post(':eventId/join')
  // Entrar a la fila es barato, pero no gratis: sin tope, un bot crea miles de
  // identidades y desplaza a la gente real hacia el final.
  @Throttle({ default: { limit: JOIN_LIMIT, ttl: 60_000 } })
  @ApiOperation({ summary: 'Join the queue (idempotent: rejoining keeps your place)' })
  async join(@Param('eventId') eventId: string, @Body() body: { memberId?: string }) {
    return this.waitingRoom.join(eventId, this.requireMember(body?.memberId));
  }

  /**
   * Sondeo. Es la ruta más golpeada de todo el sistema durante un onsale: la
   * responde Redis con un `ZRANK`, sin tocar la base.
   */
  @Get(':eventId/status')
  @Throttle({ default: { limit: STATUS_LIMIT, ttl: 60_000 } })
  @ApiOperation({ summary: 'Current position, estimated wait and admission pass' })
  async status(@Param('eventId') eventId: string, @Query('memberId') memberId?: string) {
    return this.waitingRoom.status(eventId, this.requireMember(memberId));
  }

  /** Salir de la fila al terminar o abandonar, para no inflar la espera ajena. */
  @Delete(':eventId')
  async leave(@Param('eventId') eventId: string, @Query('memberId') memberId?: string) {
    await this.waitingRoom.leave(eventId, this.requireMember(memberId));
    return { left: true };
  }

  private requireMember(memberId?: string): string {
    const trimmed = memberId?.trim();
    if (!trimmed) throw new BadRequestException('memberId es obligatorio');
    // Acota la longitud: el identificador es una clave de Redis.
    if (trimmed.length > 100) throw new BadRequestException('memberId demasiado largo');
    return trimmed;
  }
}
