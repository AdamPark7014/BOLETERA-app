import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { OrgScopedRequest } from './org-access.guard';

/**
 * F2-03 — Variante de `OrgAccessGuard` para rutas cuyo tenant no viaja en la
 * petición sino que se deduce del evento (`:eventId`).
 *
 * Resuelve la organización dueña del evento y la contrasta con la del token,
 * dejándola en `req.scopedOrganizationId`. Reutilizable por cualquier
 * controller con rutas por evento (analytics, reporting, campañas...).
 */

type GuardedRequest = {
  user?: { role?: string; organizationId?: string | null };
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
} & OrgScopedRequest;

function readEventId(req: GuardedRequest): string | undefined {
  const candidates = [req.params?.eventId, req.query?.eventId, req.body?.eventId];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

@Injectable()
export class EventOrgAccessGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<GuardedRequest>();
    const user = req.user;
    if (!user) throw new ForbiddenException('Authentication required');

    const eventId = readEventId(req);
    if (!eventId) throw new ForbiddenException('Event identifier required');

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { organizationId: true },
    });
    // Los eventos son entidades públicas del storefront: un 404 aquí no filtra
    // nada que no exponga ya el catálogo.
    if (!event) throw new NotFoundException('Event not found');

    // Sólo SUPER_ADMIN atraviesa organizaciones (ver F2-08).
    if (user.role === 'SUPER_ADMIN') {
      req.scopedOrganizationId = event.organizationId;
      return true;
    }

    if (!user.organizationId || user.organizationId !== event.organizationId) {
      throw new ForbiddenException('Organization access denied');
    }

    req.scopedOrganizationId = event.organizationId;
    return true;
  }
}
