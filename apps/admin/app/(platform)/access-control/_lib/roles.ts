import type { BadgeTone } from '@boletera/ui';

export const ACCESS_ROLE_VALUES = [
  'ADMIN',
  'PROMOTER',
  'VENUE_MANAGER',
  'TAQUILLA',
  'SCANNER',
] as const;

export type AccessRole = (typeof ACCESS_ROLE_VALUES)[number];

export type AccessRoleOption = {
  value: AccessRole;
  label: string;
  summary: string;
  tone: BadgeTone;
  permissions: readonly string[];
};

export const ACCESS_ROLES: readonly AccessRoleOption[] = [
  {
    value: 'ADMIN',
    label: 'Admin',
    summary: 'Configuración, equipo y finanzas',
    tone: 'accent',
    permissions: ['Eventos', 'Inventario', 'Equipo', 'Facturación', 'Auditoría', 'Partners'],
  },
  {
    value: 'PROMOTER',
    label: 'Promotor',
    summary: 'Eventos, campañas e inventario',
    tone: 'info',
    permissions: ['Eventos', 'Precios', 'Campañas', 'Reportes', 'Partners'],
  },
  {
    value: 'VENUE_MANAGER',
    label: 'Venue manager',
    summary: 'Venues, mapas y operaciones',
    tone: 'success',
    permissions: ['Venues', 'Mapas', 'Aforo', 'Scanner'],
  },
  {
    value: 'TAQUILLA',
    label: 'Taquilla',
    summary: 'Ventas POS y atención',
    tone: 'warning',
    permissions: ['POS', 'Órdenes', 'Clientes'],
  },
  {
    value: 'SCANNER',
    label: 'Scanner',
    summary: 'Check-in y validación',
    tone: 'neutral',
    permissions: ['Acceso', 'Validación offline'],
  },
];

const BY_VALUE = new Map<string, AccessRoleOption>(
  ACCESS_ROLES.map((role) => [role.value, role]),
);

export function accessRoleLabel(role: string): string {
  return BY_VALUE.get(role)?.label ?? role;
}
