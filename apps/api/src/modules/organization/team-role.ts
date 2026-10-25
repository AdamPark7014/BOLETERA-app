import { BadRequestException } from '@nestjs/common';
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
