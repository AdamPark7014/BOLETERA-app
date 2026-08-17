/**
 * Roles que la API acepta para escribir configuración de la organización
 * (`PATCH /organization/:orgId` y equipo). Con cualquier otro rol la vista
 * sigue siendo de solo lectura.
 */
const MANAGE_ROLES: ReadonlySet<string> = new Set([
  'ADMIN',
  'SUPER_ADMIN',
  'OWNER',
  'PROMOTER',
]);

export function canManagePlan(role: string | null): boolean {
  if (!role) return false;
  return MANAGE_ROLES.has(role.toUpperCase());
}
