import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from './jwt.strategy';

/**
 * F2-12 — Tickets de stream para SSE.
 *
 * EL PROBLEMA
 * `EventSource` no permite enviar cabeceras: `new EventSource(url)` nunca manda
 * `Authorization`. Como `JwtStrategy` sólo extraía el token del `Bearer`, el
 * endpoint `/reports/dashboard/realtime/:organizationId/stream` devolvía 401 a
 * todo navegador. El panel caía a sondeo silencioso y el usuario creía estar
 * viendo datos en vivo.
 *
 * POR QUÉ TICKET Y NO `ExtractJwt.fromUrlQueryParameter`
 * Meter el JWT de sesión en la query lo deposita, íntegro y con sus 2 h de
 * vigencia, en el access log del proxy, en el historial del navegador, en el
 * `Referer` de cualquier recurso externo y en cualquier APM que capture URLs.
 * Es una credencial de sesión completa en texto plano en media docena de sitios
 * que nadie rota. Además habilitaría `?token=` en TODA la API, no sólo en el
 * stream, lo que abre la puerta a CSRF por GET (un `<img src>` con el token de
 * la víctima ya no sirve, pero un enlace compartido con el token sí).
 *
 * EL TICKET
 * Credencial separada, de propósito único (`purpose: 'sse'`), vida corta
 * (2 min por defecto) y emitida por un endpoint que SÍ exige `Bearer`. Lo que
 * acaba en los logs es un token que caduca antes de que nadie lo lea y que
 * `JwtStrategy` rechaza explícitamente como token de sesión, así que no sirve
 * para nada más que abrir el stream.
 *
 * NO ES DE UN SOLO USO, A PROPÓSITO
 * `EventSource` reconecta solo, reusando la MISMA URL. Un ticket de un solo uso
 * haría fallar toda reconexión en silencio — exactamente el fallo que estamos
 * arreglando. El acotamiento es temporal, no por número de usos: el cliente debe
 * pedir un ticket nuevo en `onerror` y reabrir el `EventSource`. Como el ticket
 * caduca en minutos, la ventana de reproducción de uno filtrado es la misma que
 * la de un ticket de un solo uso interceptado en vuelo.
 */

export const STREAM_TICKET_PURPOSE = 'sse';

const DEFAULT_TTL_SECONDS = 120;
const MAX_TTL_SECONDS = 600;

/** Vigencia del ticket. Corta a propósito: acaba en logs de acceso. */
export const STREAM_TICKET_TTL_SECONDS = (() => {
  const raw = Number(process.env.SSE_TICKET_TTL_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.trunc(raw), MAX_TTL_SECONDS);
})();

export interface StreamTicket {
  ticket: string;
  /** Segundos de vigencia; el cliente debe renovar antes de agotarlos. */
  expiresIn: number;
}

@Injectable()
export class StreamTicketService {
  constructor(private jwt: JwtService) {}

  issue(user: { sub: string; email: string }): StreamTicket {
    const ticket = this.jwt.sign(
      { sub: user.sub, email: user.email, purpose: STREAM_TICKET_PURPOSE },
      // Anula el `expiresIn` global (2 h) del JwtModule.
      { expiresIn: STREAM_TICKET_TTL_SECONDS },
    );
    return { ticket, expiresIn: STREAM_TICKET_TTL_SECONDS };
  }

  /**
   * Verifica firma y caducidad y exige el propósito. Rol y organización NO se
   * leen de aquí: los resuelve `JwtStrategy.resolveUser` contra la base, para
   * que revocar o degradar a alguien corte también sus streams abiertos.
   */
  verify(raw: string): JwtPayload {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(raw);
    } catch {
      throw new UnauthorizedException('Invalid or expired stream ticket');
    }
    if (payload?.purpose !== STREAM_TICKET_PURPOSE) {
      // Un token de sesión normal presentado por la query: se rechaza para que
      // el ticket sea la ÚNICA credencial que viaja en una URL.
      throw new UnauthorizedException('Invalid stream ticket');
    }
    return payload;
  }
}
