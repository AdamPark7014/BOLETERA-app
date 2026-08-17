import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { invalidateUserAuthCache } from './jwt.strategy';

/**
 * F2-02 — Única vía de elevación de rol.
 *
 * El SSO autentica (demuestra que quien entra controla ese buzón); NO autoriza.
 * Un usuario sólo sale de CUSTOMER si existe una `OrgInvitation` viva —no
 * aceptada y no caducada— emitida para su correo por alguien de la
 * organización con rango suficiente.
 */

/** Caducidad por defecto de una invitación, en días. */
export const DEFAULT_INVITATION_TTL_DAYS = 7;

/**
 * Jerarquía de roles para acotar quién puede conceder qué.
 * Nadie puede invitar por encima de su propio rango, así un PROMOTER no se
 * fabrica un ADMIN de su organización.
 */
const ROLE_RANK: Record<string, number> = {
  CUSTOMER: 0,
  SCANNER: 1,
  TAQUILLA: 2,
  ARTIST: 2,
  VENUE_MANAGER: 3,
  PROMOTER: 4,
  ADMIN: 5,
  SUPER_ADMIN: 6,
};

/**
 * SUPER_ADMIN es transversal a toda la plataforma: no es un rol de
 * organización y no se concede por invitación, se aprovisiona fuera de banda.
 * CUSTOMER no tiene sentido como invitación (es el estado por defecto).
 */
const INVITABLE_ROLES: UserRole[] = [
  UserRole.SCANNER,
  UserRole.TAQUILLA,
  UserRole.ARTIST,
  UserRole.VENUE_MANAGER,
  UserRole.PROMOTER,
  UserRole.ADMIN,
];

export interface CreateInvitationInput {
  organizationId: string;
  email: string;
  role: UserRole;
  /** Rol de quien invita — acota el rango concedible. */
  inviterRole: string;
  inviterId?: string;
  /** Organización del que invita; sólo SUPER_ADMIN puede invitar fuera de la suya. */
  inviterOrganizationId?: string | null;
  expiresInDays?: number;
}

@Injectable()
export class InvitationsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Aplica la invitación viva que corresponda al correo del usuario.
   * Idempotente y a prueba de carreras: la invitación se reclama con un
   * `updateMany` condicionado a `acceptedAt: null`, de modo que dos logins
   * simultáneos no la consuman dos veces.
   *
   * Devuelve el usuario resultante (elevado o intacto).
   */
  async applyPendingInvitation<T extends { id: string; email: string }>(user: T): Promise<T> {
    const invitation = await this.prisma.orgInvitation.findFirst({
      where: {
        email: user.email.toLowerCase(),
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      // Si hubiera varias organizaciones invitando al mismo correo, gana la más
      // reciente; el resto queda pendiente y podrá aceptarse en otro login.
      orderBy: { createdAt: 'desc' },
    });

    if (!invitation) return user;

    const claimed = await this.prisma.orgInvitation.updateMany({
      where: { id: invitation.id, acceptedAt: null },
      data: { acceptedAt: new Date(), acceptedByUserId: user.id },
    });
    // Otra sesión concurrente la consumió: no elevamos nada.
    if (claimed.count === 0) return user;

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { role: invitation.role, organizationId: invitation.organizationId },
    });

    // El rol acaba de cambiar: tira la caché de JwtStrategy para que el token
    // que estamos a punto de emitir resuelva ya con el rol nuevo.
    invalidateUserAuthCache(user.id);

    return { ...user, ...updated } as unknown as T;
  }

  /** Crea (o reemite) la invitación de una organización para un correo. */
  async createInvitation(input: CreateInvitationInput) {
    const organizationId = input.organizationId?.trim();
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }

    const email = input.email?.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw new BadRequestException('A valid email is required');
    }

    if (!INVITABLE_ROLES.includes(input.role)) {
      throw new BadRequestException(
        `role must be one of: ${INVITABLE_ROLES.join(', ')}`,
      );
    }

    // Defensa en profundidad: OrgAccessGuard ya compara el organizationId del
    // cuerpo con el del token, pero el servicio no confía en el guard.
    if (
      input.inviterRole !== 'SUPER_ADMIN' &&
      input.inviterOrganizationId !== organizationId
    ) {
      throw new ForbiddenException('Cannot invite into another organization');
    }

    const inviterRank = ROLE_RANK[input.inviterRole] ?? 0;
    if ((ROLE_RANK[input.role] ?? 99) > inviterRank) {
      throw new ForbiddenException('Cannot grant a role above your own');
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    const days = input.expiresInDays ?? DEFAULT_INVITATION_TTL_DAYS;
    if (!Number.isFinite(days) || days <= 0 || days > 90) {
      throw new BadRequestException('expiresInDays must be between 1 and 90');
    }
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    // @@unique([organizationId, email]): reinvitar reabre la misma fila con
    // caducidad nueva y la desmarca como aceptada sólo si aún no lo estaba.
    const existing = await this.prisma.orgInvitation.findUnique({
      where: { organizationId_email: { organizationId, email } },
    });

    if (existing?.acceptedAt) {
      throw new BadRequestException(
        'That email already accepted an invitation for this organization',
      );
    }

    const invitation = existing
      ? await this.prisma.orgInvitation.update({
          where: { id: existing.id },
          data: { role: input.role, expiresAt, invitedById: input.inviterId ?? null },
        })
      : await this.prisma.orgInvitation.create({
          data: {
            organizationId,
            email,
            role: input.role,
            expiresAt,
            invitedById: input.inviterId ?? null,
          },
        });

    return this.toDto(invitation);
  }

  /** Invitaciones de una organización, más recientes primero. */
  async listByOrganization(organizationId?: string | null) {
    if (!organizationId) throw new BadRequestException('organizationId is required');
    const invitations = await this.prisma.orgInvitation.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return invitations.map((invitation) => this.toDto(invitation));
  }

  /**
   * Revoca una invitación pendiente. Sin esto, un correo tecleado mal queda
   * como concesión de privilegio latente durante toda su caducidad.
   */
  async revokeInvitation(id: string, scopedOrganizationId?: string | null) {
    const invitation = await this.prisma.orgInvitation.findUnique({ where: { id } });
    if (!invitation) throw new NotFoundException('Invitation not found');

    if (scopedOrganizationId && invitation.organizationId !== scopedOrganizationId) {
      throw new ForbiddenException('Organization access denied');
    }
    if (invitation.acceptedAt) {
      throw new BadRequestException('Cannot revoke an already accepted invitation');
    }

    await this.prisma.orgInvitation.delete({ where: { id } });
    return { ok: true, id };
  }

  private toDto(invitation: {
    id: string;
    organizationId: string;
    email: string;
    role: UserRole;
    invitedById: string | null;
    expiresAt: Date;
    acceptedAt: Date | null;
    acceptedByUserId: string | null;
    createdAt: Date;
  }) {
    const live = !invitation.acceptedAt && invitation.expiresAt > new Date();
    return {
      id: invitation.id,
      organizationId: invitation.organizationId,
      email: invitation.email,
      role: invitation.role,
      invitedById: invitation.invitedById,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      acceptedByUserId: invitation.acceptedByUserId,
      createdAt: invitation.createdAt,
      status: invitation.acceptedAt ? 'ACCEPTED' : live ? 'PENDING' : 'EXPIRED',
    };
  }
}
