import {
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { StreamTicketService } from './stream-ticket.service';

export const ALLOW_STREAM_TICKET_KEY = 'allowStreamTicket';

/**
 * Habilita el ticket de query (`?ticket=`) en UNA ruta concreta.
 *
 * Es opt-in por handler a propósito: si el guard aceptase el ticket en
 * cualquier ruta, tendríamos una credencial por URL en toda la API. Sólo tiene
 * sentido donde el cliente no puede poner cabeceras, es decir, en `@Sse()`.
 */
export const AllowStreamTicket = () => SetMetadata(ALLOW_STREAM_TICKET_KEY, true);

/**
 * F2-12 — Sustituto de `JwtAuthGuard` para controllers con rutas SSE.
 *
 * Camino normal: idéntico a `JwtAuthGuard` (passport-jwt sobre `Bearer`).
 * Camino SSE: si el handler lleva `@AllowStreamTicket()` y la petición NO trae
 * `Authorization`, acepta un ticket de vida corta por query y publica en
 * `req.user` la MISMA identidad que produciría el Bearer, para que
 * `RolesGuard` y `OrgAccessGuard` sigan aplicando sin cambios.
 */
@Injectable()
export class StreamAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    private tickets: StreamTicketService,
    private jwtStrategy: JwtStrategy,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    const ticketAllowed = this.reflector.getAllAndOverride<boolean>(ALLOW_STREAM_TICKET_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // El Bearer tiene prioridad: si el cliente sabe mandar cabeceras (curl, el
    // SDK del servidor), no hay motivo para aceptarle una credencial en la URL.
    const hasBearer = typeof req.headers?.authorization === 'string';
    const rawTicket = ticketAllowed && !hasBearer ? readTicket(req) : undefined;

    if (!rawTicket) {
      return (await super.canActivate(context)) as boolean;
    }

    const payload = this.tickets.verify(rawTicket);
    const user = await this.jwtStrategy.resolveUser(payload);
    if (!user) throw new UnauthorizedException('Invalid stream ticket');
    req.user = user;
    return true;
  }
}

function readTicket(req: { query?: Record<string, unknown> }): string | undefined {
  const raw = req.query?.ticket;
  // Express entrega arrays con `?ticket=a&ticket=b`; sólo aceptamos cadenas.
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}
