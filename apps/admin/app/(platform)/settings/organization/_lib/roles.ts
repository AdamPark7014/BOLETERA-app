import type { BadgeTone } from '@boletera/ui';

/** Roles invitables vía `POST /organization/:id/team`. */
export const TEAM_ROLE_VALUES = [
  'ADMIN',
  'PROMOTER',
  'VENUE_MANAGER',
  'TAQUILLA',
  'SCANNER',
] as const;

export type TeamRole = (typeof TEAM_ROLE_VALUES)[number];

export type RoleOption = {
  value: TeamRole;
  label: string;
  tone: BadgeTone;
  permissions: readonly string[];
};

export const TEAM_ROLES: readonly RoleOption[] = [
  {
    value: 'ADMIN',
    label: 'Admin',
    tone: 'accent',
    permissions: ['Eventos', 'Inventario', 'Equipo', 'Facturación', 'Auditoría', 'Partners'],
  },
  {
    value: 'PROMOTER',
    label: 'Promotor',
    tone: 'info',
    permissions: ['Eventos', 'Precios', 'Campañas', 'Reportes', 'Partners'],
  },
  {
    value: 'VENUE_MANAGER',
    label: 'Venue manager',
    tone: 'success',
    permissions: ['Venues', 'Mapas', 'Aforo', 'Scanner'],
  },
  {
    value: 'TAQUILLA',
    label: 'Taquilla',
    tone: 'warning',
    permissions: ['POS', 'Órdenes', 'Clientes'],
  },
  {
    value: 'SCANNER',
    label: 'Scanner',
    tone: 'neutral',
    permissions: ['Acceso', 'Validación offline'],
  },
];

const ROLE_BY_VALUE = new Map<string, RoleOption>(
  TEAM_ROLES.map((role) => [role.value, role]),
);

export function isTeamRole(value: string): value is TeamRole {
  return ROLE_BY_VALUE.has(value);
}

export function roleLabel(role: string): string {
  return ROLE_BY_VALUE.get(role)?.label ?? role;
}

export function roleTone(role: string): BadgeTone {
  return ROLE_BY_VALUE.get(role)?.tone ?? 'neutral';
}

export function rolePermissions(role: string): readonly string[] {
  return ROLE_BY_VALUE.get(role)?.permissions ?? [];
}
