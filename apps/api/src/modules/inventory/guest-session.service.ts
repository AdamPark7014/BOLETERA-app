import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Identidad de invitado FIRMADA POR EL SERVIDOR.
 *
 * ── El agujero que cierra ──
 *
 * El tope de boletos por comprador (`MAX_ACTIVE_TICKETS_PER_SESSION`) se
 * aplicaba contra el `sessionId` que mandaba el propio cliente, y el control
 * era solo «que venga alguno»:
 *
 *     const trimmed = sessionId?.trim();
 *     if (!trimmed && !user?.sub) throw new BadRequestException(...);
 *     return trimmed || undefined;
 *
 * Es decir: el limite por comprador se imponia sobre un valor que el comprador
 * elige. Un bot manda un `sessionId` aleatorio distinto en cada peticion y el
 * tope deja de existir. La unica defensa que quedaba era el limite por IP
 * (30 holds/min), que cae con cualquier pool de proxies.
 *
 * Eso es exactamente lo que los lineamientos de PROFECO (DOF, 19 de febrero de
 * 2026) obligan a cubrir: «proteger los sistemas contra bots y duplicidades».
 *
 * ── Como se cierra ──
 *
 * El servidor emite la identidad y la firma. El cliente solo puede devolverla,
 * no inventarla. Un bot sigue pudiendo pedir identidades nuevas, pero ahora esa
 * peticion es un punto unico y estrecho donde limitar y contar — antes el
 * acaparamiento no dejaba ni rastro atribuible.
 *
 * Formato: `v2.<id>.<emitido>.<firma>` en base64url. No lleva datos personales:
 * es un identificador opaco, para que enviarlo en el cuerpo no filtre nada.
 *
 * ── Compatibilidad ──
 *
 * Durante la migracion se aceptan identidades antiguas sin firma, igual que se
 * hizo con las firmas v1 del QR. Con `GUEST_SESSION_STRICT=true` se exige firma
 * y se cierra el agujero del todo. Se deja abierto por omision porque cerrarlo
 * de golpe tumbaria los carritos de todos los compradores que ya tengan una
 * sesion vieja guardada en el navegador.
 */

const VERSION = 'v2';

/** Vida de la identidad. Larga: sobrevive a un onsale y a dudarlo un rato. */
const TTL_MS = Number(process.env.GUEST_SESSION_TTL_HOURS ?? 12) * 3_600_000;

/** Con `true` se rechaza toda identidad sin firma valida. */
const STRICT = process.env.GUEST_SESSION_STRICT === 'true';

function secret(): string {
  const value = process.env.GUEST_SESSION_SECRET ?? process.env.JWT_SECRET;
  if (!value) {
    // Sin secreto la firma no vale nada. Mejor fallar al arrancar que emitir
    // identidades que cualquiera puede falsificar creyendo que estan firmadas.
    throw new Error(
      'Falta GUEST_SESSION_SECRET (o JWT_SECRET): la identidad de invitado no se puede firmar.',
    );
  }
  return value;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Comparacion en tiempo constante; longitudes distintas no revientan. */
function equals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type GuestSession = {
  /** El token completo, que es lo que el cliente guarda y devuelve. */
  token: string;
  /** Identificador estable con el que se contabilizan los topes. */
  id: string;
  expiresAt: Date;
};

export type VerifiedIdentity = {
  /** Identidad con la que contar boletos. */
  id: string;
  /** `false` cuando venia sin firma y se acepto por compatibilidad. */
  signed: boolean;
};

@Injectable()
export class GuestSessionService {
  private readonly logger = new Logger(GuestSessionService.name);

  /** Emite una identidad nueva. Es el unico sitio donde nacen. */
  issue(): GuestSession {
    const id = randomBytes(16).toString('base64url');
    const issuedAt = Date.now();
    const payload = `${VERSION}.${id}.${issuedAt}`;
    return {
      token: `${payload}.${sign(payload)}`,
      id,
      expiresAt: new Date(issuedAt + TTL_MS),
    };
  }

  /**
   * Comprueba una identidad recibida del cliente.
   *
   * Devuelve el identificador con el que contabilizar, o lanza si la identidad
   * es invalida. Nunca devuelve el token entero: quien cuenta boletos debe usar
   * el `id`, para que dos tokens del mismo id (renovado, por ejemplo) no
   * cuenten como dos compradores distintos.
   */
  verify(raw: string | undefined, now: number = Date.now()): VerifiedIdentity | null {
    const token = raw?.trim();
    if (!token) return null;

    const parts = token.split('.');

    // Identidad antigua sin firma.
    if (parts.length !== 4 || parts[0] !== VERSION) {
      if (STRICT) {
        throw new BadRequestException(
          'Sesión de invitado no válida. Recarga la página para obtener una nueva.',
        );
      }
      return { id: token, signed: false };
    }

    const [, id, issuedAtRaw, signature] = parts;
    const payload = `${VERSION}.${id}.${issuedAtRaw}`;

    if (!equals(signature, sign(payload))) {
      // Una firma que no cuadra NO es un cliente viejo: es una falsificacion.
      // Se rechaza aunque el modo estricto este apagado.
      this.logger.warn('Identidad de invitado con firma inválida; rechazada.');
      throw new BadRequestException(
        'Sesión de invitado no válida. Recarga la página para obtener una nueva.',
      );
    }

    const issuedAt = Number(issuedAtRaw);
    if (!Number.isFinite(issuedAt) || now - issuedAt > TTL_MS || issuedAt > now + 60_000) {
      // El margen de 60 s hacia el futuro absorbe un reloj adelantado; mas que
      // eso es un token manipulado para no caducar nunca.
      throw new BadRequestException(
        'Sesión de invitado expirada. Recarga la página para continuar.',
      );
    }

    return { id, signed: true };
  }

  /** ¿Se está exigiendo firma? Lo usan las métricas y el diagnóstico. */
  get strict(): boolean {
    return STRICT;
  }
}
