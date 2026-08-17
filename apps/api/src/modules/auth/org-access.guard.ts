import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Aislamiento multi-tenant. No hay RLS en PostgreSQL: este guard y el filtrado
 * de cada servicio son lo único que separa a un promotor de otro.
 *
 * F2-08 — Dos defectos corregidos:
 *
 * 1) ADMIN ya no queda exento. `ADMIN` es un rol POR ORGANIZACIÓN, no de
 *    plataforma: eximirlo permitía que el ADMIN de un promotor leyera y
 *    escribiera los datos de cualquier otro. Sólo `SUPER_ADMIN` es transversal.
 *
 * 2) Una petición sin `organizationId` explícito ya no se aprueba a ciegas.
 *    Antes `if (!requested) return true;` convertía el guard en decorativo en
 *    toda ruta que resolviera el tenant por otra vía. Ahora se exige que el
 *    usuario tenga organización en su token y se publica en
 *    `req.scopedOrganizationId` para que el controller/servicio filtre por ahí.
 *
 * CONTRATO: el guard sólo AÑADE `req.scopedOrganizationId`; no toca `req.user`.
 */

/** Petición con el tenant ya resuelto y validado por el guard. */
export interface OrgScopedRequest {
  scopedOrganizationId?: string | null;
}

type GuardedRequest = {
  user?: { role?: string; organizationId?: string | null };
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
} & OrgScopedRequest;

/** Primer identificador de organización presente en params, query o body. */
function readRequestedOrgId(req: GuardedRequest): string | undefined {
  const candidates = [
    req.params?.organizationId,
    req.params?.orgId,
    req.query?.organizationId,
    req.query?.orgId,
    req.body?.organizationId,
    req.body?.orgId,
  ];
  for (const candidate of candidates) {
    // Express puede entregar arrays en query (?orgId=a&orgId=b); sólo
    // aceptamos cadenas para que un array no se cuele como "sin solicitar".
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

@Injectable()
export class OrgAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<GuardedRequest>();
    const user = req.user;
    if (!user) throw new ForbiddenException('Authentication required');

    const requested = readRequestedOrgId(req);

    // SUPER_ADMIN es el único rol de plataforma: puede operar sobre cualquier
    // organización, pero dejamos igualmente el tenant resuelto para que los
    // servicios filtren en lugar de devolver la base entera.
    if (user.role === 'SUPER_ADMIN') {
      req.scopedOrganizationId = requested ?? user.organizationId ?? null;
      return true;
    }

    if (!user.organizationId) {
      // Cuenta sin tenant (p. ej. un CUSTOMER recién registrado, o un rol
      // privilegiado huérfano) intentando entrar por una ruta de organización.
      throw new ForbiddenException('Organization access denied');
    }

    if (requested && requested !== user.organizationId) {
      throw new ForbiddenException('Organization access denied');
    }

    req.scopedOrganizationId = user.organizationId;
    return true;
  }
}
