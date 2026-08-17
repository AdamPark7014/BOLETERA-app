import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { StreamTicketService, type StreamTicket } from './stream-ticket.service';

/**
 * F2-12 — Emisor de tickets de SSE. Ver `stream-ticket.service.ts` para el
 * porqué del diseño.
 *
 * Uso desde el navegador:
 *   const { ticket } = await fetch('/auth/stream-ticket', {
 *     method: 'POST', headers: { Authorization: `Bearer ${jwt}` },
 *   }).then(r => r.json());
 *   const es = new EventSource(`/reports/dashboard/realtime/${orgId}/stream?ticket=${ticket}`);
 *
 * En `es.onerror` hay que cerrar, pedir un ticket nuevo y reabrir: el ticket
 * caduca en minutos y la reconexión automática de EventSource reusa la URL vieja.
 */
@ApiTags('Auth')
@Controller('auth')
export class StreamTicketController {
  constructor(private tickets: StreamTicketService) {}

  @Post('stream-ticket')
  @UseGuards(JwtAuthGuard)
  // Un ticket por stream y por reconexión: 30/min deja margen a un panel con
  // varios paneles abiertos sin convertir esto en una fábrica de credenciales.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Issue a short-lived ticket for EventSource (SSE) streams' })
  issue(@CurrentUser() user: { sub: string; email: string }): StreamTicket {
    // La identidad sale del JWT ya validado, nunca del cuerpo.
    return this.tickets.issue(user);
  }
}
