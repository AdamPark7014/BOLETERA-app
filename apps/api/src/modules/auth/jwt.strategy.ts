import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { requireJwtSecret } from './jwt-secret';

/**
 * F2-07 — El JWT dejó de ser la fuente de verdad de rol/organización.
 *
 * Antes `validate()` devolvía el payload tal cual: despedir a un cajero,
 * degradar un rol o desactivar una cuenta no surtía efecto hasta que el token
 * caducaba (24 h). Ahora el rol, la organización y el estado `active` se leen
 * de la base en cada petición, con una caché en memoria de TTL corto para no
 * meter una consulta por request en el camino crítico.
 *
 * VENTANA MÁXIMA DE REVOCACIÓN = AUTH_CACHE_TTL_MS (30 s por defecto).
 * Desactivar o degradar a un usuario tarda como mucho ese TTL en propagarse a
 * las instancias del API que ya lo tuvieran cacheado. Las mutaciones que
 * hacemos nosotros mismos (aceptar invitación) invalidan la entrada al vuelo
 * vía `invalidateUserAuthCache()`; las que hacen otros módulos (p. ej.
 * organization.service al cambiar rol) se propagan por TTL.
 *
 * La caché es por proceso: con N instancias del API hay N cachés
 * independientes, pero el TTL acota la ventana igual en todas.
 */

export interface JwtPayload {
  sub: string;
  email: string;
  role?: string;
  organizationId?: string | null;
  /**
   * Discrimina el tipo de credencial. Ausente (o `'session'`) = token de sesión
   * normal. Los tickets de SSE llevan `'sse'` y esta estrategia los RECHAZA:
   * comparten secreto de firma, así que sin esta comprobación un ticket
   * filtrado de los logs del proxy valdría como `Authorization: Bearer` para
   * toda la API (ver stream-ticket.service.ts).
   */
  purpose?: string;
  /** Emisión del token, en segundos epoch (lo pone jsonwebtoken). */
  iat?: number;
  exp?: number;
}

/** Identidad resuelta contra la base que se publica en `req.user`. */
export interface AuthenticatedUser {
  sub: string;
  email: string;
  role: string;
  organizationId: string | null;
  active: true;
  tokenIssuedAt: number | null;
  profileUpdatedAt: Date;
}

/** Estado vivo del usuario, leído de la base. */
interface AuthSnapshot {
  role: string;
  organizationId: string | null;
  updatedAt: Date;
}

const DEFAULT_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 5_000;

/** TTL de la caché = ventana máxima de revocación. Configurable para pruebas. */
export const AUTH_CACHE_TTL_MS = (() => {
  const raw = Number(process.env.AUTH_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_TTL_MS;
})();

/**
 * Holgura entre `iat` (segundos, truncado) y `updatedAt` (milisegundos).
 * Sin ella todo login recién emitido se auto-invalidaría: firmar el token y
 * sellar `lastLogin` ocurren en el mismo segundo y cualquier escritura sobre
 * la fila de User refresca `updatedAt`. Reduce la precisión de la revocación
 * por `updatedAt` a un minuto, lo cual es irrelevante frente al TTL de sesión.
 */
const TOKEN_ISSUANCE_SKEW_SECONDS = 60;

const snapshotCache = new Map<string, { snapshot: AuthSnapshot | null; expiresAt: number }>();

/** Fuerza la relectura del usuario en la siguiente petición (cambio de rol). */
export function invalidateUserAuthCache(userId: string): void {
  snapshotCache.delete(userId);
}

/** Vacía la caché completa (útil en tests y en apagados controlados). */
export function clearAuthCache(): void {
  snapshotCache.clear();
}

function pruneExpired(now: number): void {
  for (const [key, value] of snapshotCache) {
    if (value.expiresAt <= now) snapshotCache.delete(key);
  }
  // Si tras la poda sigue lleno, la caché ha crecido más allá de lo previsto:
  // la vaciamos entera antes que dejarla crecer sin límite (fuga de memoria).
  if (snapshotCache.size >= MAX_CACHE_ENTRIES) snapshotCache.clear();
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret(),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (payload?.purpose && payload.purpose !== 'session') {
      // Credencial de propósito acotado (hoy, el ticket de SSE) presentada como
      // token de sesión. Misma firma, permisos distintos: no se acepta aquí.
      throw new UnauthorizedException('Invalid token');
    }
    return this.resolveUser(payload);
  }

  /**
   * Resuelve la identidad viva a partir de un payload YA VERIFICADO
   * criptográficamente. Se expone para que `StreamAuthGuard` autentique un
   * ticket de SSE con exactamente las mismas reglas de revocación (cuenta
   * desactivada, rol degradado, `updatedAt` posterior a la emisión) en lugar de
   * duplicarlas y que se desincronicen.
   */
  async resolveUser(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload?.sub) throw new UnauthorizedException('Invalid token');

    const snapshot = await this.loadSnapshot(payload.sub);
    if (!snapshot) {
      // Cuenta borrada o desactivada: el token sigue siendo criptográficamente
      // válido pero ya no representa a nadie con acceso.
      throw new UnauthorizedException('Account is no longer active');
    }

    // `tokenVersion` lógico: cualquier escritura sobre el usuario (cambio de
    // rol, de organización, baja, reset de contraseña) refresca `updatedAt` y
    // deja obsoletos los tokens emitidos antes. Es la revocación inmediata que
    // el modelo Session nunca llegó a dar.
    if (
      payload.iat &&
      snapshot.updatedAt.getTime() > (payload.iat + TOKEN_ISSUANCE_SKEW_SECONDS) * 1000
    ) {
      throw new UnauthorizedException('Session superseded by an account change — sign in again');
    }

    // CONTRATO: {sub, email, role, organizationId} se mantiene intacto para los
    // ~29 controllers que ya lo consumen; el resto son campos AÑADIDOS.
    // `role` y `organizationId` ya NO vienen del token: son los de la base.
    return {
      sub: payload.sub,
      email: payload.email,
      role: snapshot.role,
      organizationId: snapshot.organizationId,
      // --- campos añadidos ---
      active: true,
      tokenIssuedAt: payload.iat ?? null,
      profileUpdatedAt: snapshot.updatedAt,
    };
  }

  private async loadSnapshot(userId: string): Promise<AuthSnapshot | null> {
    const now = Date.now();
    const cached = snapshotCache.get(userId);
    if (cached && cached.expiresAt > now) return cached.snapshot;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, organizationId: true, active: true, updatedAt: true },
    });

    // Cacheamos también el negativo: si la cuenta no existe o está desactivada
    // no queremos una consulta por cada petición de un token zombi.
    const snapshot: AuthSnapshot | null =
      user && user.active
        ? {
            role: user.role,
            organizationId: user.organizationId,
            updatedAt: user.updatedAt,
          }
        : null;

    if (snapshotCache.size >= MAX_CACHE_ENTRIES) pruneExpired(now);
    snapshotCache.set(userId, { snapshot, expiresAt: now + AUTH_CACHE_TTL_MS });
    return snapshot;
  }
}
