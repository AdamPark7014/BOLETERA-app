import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

const CATALOG = new Set<string>(Object.values(UserRole));

/** Los valores de `UserRole` en Prisma. No añade roles. */
export function catalogRoles(): readonly UserRole[] {
  return Object.values(UserRole);
}

/**
 * `undefined` no cambia la columna. Cualquier otro valor tiene que ser
 * uno de los 15 del enum.
 */
export function assertCatalogRole(role: unknown): UserRole | undefined {
  if (role === undefined) return undefined;
  if (typeof role === 'string' && CATALOG.has(role)) return role as UserRole;
  throw new BadRequestException('El rol tiene que ser uno de los 15 del catálogo');
}

/**
 * Rango de cada rol para decidir quién puede conceder o cambiar qué.
 * Única tabla: la usan el cambio de rol del personal y las invitaciones. Los ocho
 * roles de menú conservan el rango que ya tenían en las invitaciones; los otros
 * siete se acomodan por lo que pueden tocar (dinero y taquilla arriba de
 * operación de puerta, afiliado casi como cliente).
 */
export const ROLE_RANK: Record<UserRole, number> = {
  CUSTOMER: 0,
  AFFILIATE: 1,
  SCANNER: 1,
  TAQUILLA: 2,
  ARTIST: 2,
  SUPPORT: 2,
  TAQUILLA_SUPERVISOR: 3,
  TAQUILLA_ADMIN: 3,
  MARKETING: 3,
  AUDITOR: 3,
  VENUE_MANAGER: 3,
  FINANCE: 4,
  PROMOTER: 4,
  ADMIN: 5,
  SUPER_ADMIN: 6,
};

export function roleRank(role: string | null | undefined): number {
  return role && role in ROLE_RANK ? ROLE_RANK[role as UserRole] : 0;
}

export type RoleActor = {
  sub?: string | null;
  role?: string | null;
  organizationId?: string | null;
};

/** ¿Puede `actorRole` conceder `role`? Solo SUPER_ADMIN concede SUPER_ADMIN. */
export function canGrantRole(actorRole: string | null | undefined, role: UserRole): boolean {
  if (actorRole === UserRole.SUPER_ADMIN) return true;
  if (role === UserRole.SUPER_ADMIN) return false;
  return roleRank(role) <= roleRank(actorRole);
}

/** Roles del catálogo que `actorRole` puede conceder. */
export function grantableRoles(actorRole: string | null | undefined): UserRole[] {
  return catalogRoles().filter((role) => canGrantRole(actorRole, role));
}

/** Concede un rol nuevo (alta o invitación): nunca por encima del propio. */
export function assertCanGrant(actor: RoleActor, role: UserRole): void {
  if (!canGrantRole(actor.role, role)) {
    throw new ForbiddenException('No puedes conceder un rol por encima del tuyo.');
  }
}

/**
 * Cambio de rol o de estado de una persona del personal.
 *
 * - Nadie se cambia su propio rol ni se desactiva a sí mismo.
 * - Fuera de SUPER_ADMIN, la persona tiene que ser de la organización del actor.
 * - Solo SUPER_ADMIN toca a un SUPER_ADMIN o concede ese rol.
 * - Nadie modifica a alguien de rango igual o mayor (un ADMIN no degrada a otro ADMIN).
 * - Nadie concede un rol por encima del suyo.
 */
export function assertCanModifyMember(
  actor: RoleActor,
  target: { id: string; role: UserRole; organizationId: string | null },
  change: { role?: UserRole; active?: boolean }
): void {
  const isSuper = actor.role === UserRole.SUPER_ADMIN;
  if (actor.sub && actor.sub === target.id) {
    if (change.role !== undefined && change.role !== target.role) {
      throw new ForbiddenException('No puedes cambiar tu propio rol.');
    }
    if (change.active === false) {
      throw new ForbiddenException('No puedes desactivar tu propia cuenta.');
    }
    return;
  }
  if (!isSuper && (!actor.organizationId || actor.organizationId !== target.organizationId)) {
    throw new ForbiddenException('Esa persona no es de tu organización.');
  }
  if (isSuper) return;
  if (target.role === UserRole.SUPER_ADMIN) {
    throw new ForbiddenException('Solo un super administrador modifica a otro.');
  }
  if (roleRank(target.role) >= roleRank(actor.role)) {
    throw new ForbiddenException('No puedes modificar a alguien de tu mismo rango o superior.');
  }
  if (change.role !== undefined) assertCanGrant(actor, change.role);
}
