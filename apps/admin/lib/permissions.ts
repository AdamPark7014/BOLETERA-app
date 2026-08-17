/**
 * Matriz de permisos del backoffice (principio de mínimo privilegio).
 *
 * El backoffice no tenía ninguna comprobación de rol: todo el menú se pintaba
 * para cualquier usuario autenticado y el 403 llegaba —en silencio— al abrir la
 * pantalla. Esta tabla es el espejo de cliente de los `@Roles()` del API; no
 * sustituye al guard del servidor, solo evita ofrecer lo que no se puede usar.
 *
 * Regla: si el API exige un rol para el endpoint principal de una pantalla, la
 * pantalla exige la capacidad equivalente aquí.
 */

export type Role =
  | 'CUSTOMER'
  | 'SCANNER'
  | 'TAQUILLA'
  | 'ARTIST'
  | 'VENUE_MANAGER'
  | 'PROMOTER'
  | 'ADMIN'
  | 'SUPER_ADMIN';

export type Capability =
  /** Ver el resumen de operación. */
  | 'dashboard.view'
  /** Listar y abrir eventos. */
  | 'events.view'
  /** Crear, editar y publicar eventos. */
  | 'events.manage'
  /** Ver órdenes. */
  | 'orders.view'
  /** Reembolsar y cancelar órdenes (mueve dinero). */
  | 'orders.refund'
  /** Ver recintos y sus mapas. */
  | 'venues.view'
  /** Editar el mapa de butacas. */
  | 'venues.editMap'
  /** Bloqueos y liberaciones administrativas de inventario. */
  | 'inventory.operate'
  /** Panel en vivo del onsale. */
  | 'inventory.monitor'
  /** Analítica de promotor. */
  | 'analytics.view'
  /** Reportes de venta y manifiestos. */
  | 'reports.view'
  /** Liquidaciones, payouts y CFDI. */
  | 'finance.view'
  /** Canales, campañas y lista de espera. */
  | 'marketing.manage'
  /** Escaneo de acceso en puerta. */
  | 'access.scan'
  /** Punto de venta de taquilla. */
  | 'boxoffice.operate'
  /** Equipo, invitaciones y claves de API. */
  | 'org.manage'
  /** Bitácora de auditoría. */
  | 'audit.view'
  /** Configuración de pasarela de pago. */
  | 'settings.payments'
  /** Branding y ajustes de marca. */
  | 'settings.branding'
  /** Reportes de egress / seguridad. */
  | 'safety.view'
  /** Fraude y riesgo. */
  | 'risk.view';

/**
 * Capacidades por rol.
 *
 * `SUPER_ADMIN` no aparece: tiene todas por definición (ver `hasCapability`).
 * `CUSTOMER` tampoco: no debería entrar al backoffice — tras el cambio de SSO
 * es el rol por defecto de quien llega sin invitación, así que se le trata
 * explícitamente como "sin acceso".
 */
const MATRIX: Record<Role, Capability[]> = {
  SUPER_ADMIN: [],
  CUSTOMER: [],

  /** Personal de puerta: solo escanear. */
  SCANNER: ['access.scan'],

  /** Taquilla: vende y opera inventario en sala; nada de finanzas ni mapas. */
  TAQUILLA: ['boxoffice.operate', 'access.scan', 'events.view', 'orders.view', 'inventory.monitor'],

  /** Artista / representación: solo lectura de su evento y aforo. */
  ARTIST: ['events.view', 'analytics.view', 'inventory.monitor'],

  /** Gestor de recinto: mapas, aforo y seguridad; no ve dinero. */
  VENUE_MANAGER: [
    'dashboard.view',
    'events.view',
    'venues.view',
    'venues.editMap',
    'inventory.operate',
    'inventory.monitor',
    'safety.view',
    'access.scan',
    'reports.view',
  ],

  /** Promotor: dueño comercial del evento. */
  PROMOTER: [
    'dashboard.view',
    'events.view',
    'events.manage',
    'orders.view',
    'venues.view',
    'inventory.operate',
    'inventory.monitor',
    'analytics.view',
    'reports.view',
    'finance.view',
    'marketing.manage',
    'audit.view',
  ],

  /** Administrador de la organización. */
  ADMIN: [
    'dashboard.view',
    'events.view',
    'events.manage',
    'orders.view',
    'orders.refund',
    'venues.view',
    'venues.editMap',
    'inventory.operate',
    'inventory.monitor',
    'analytics.view',
    'reports.view',
    'finance.view',
    'marketing.manage',
    'access.scan',
    'boxoffice.operate',
    'org.manage',
    'audit.view',
    'settings.payments',
    'settings.branding',
    'safety.view',
    'risk.view',
  ],
};

/** Todas las capacidades conocidas (para `SUPER_ADMIN`). */
export const ALL_CAPABILITIES: Capability[] = [
  ...new Set(Object.values(MATRIX).flat()),
];

export function isKnownRole(role: string | null | undefined): role is Role {
  return !!role && role in MATRIX;
}

export function capabilitiesFor(role: string | null | undefined): Capability[] {
  if (role === 'SUPER_ADMIN') return ALL_CAPABILITIES;
  if (!isKnownRole(role)) return [];
  return MATRIX[role];
}

export function hasCapability(role: string | null | undefined, cap: Capability): boolean {
  if (role === 'SUPER_ADMIN') return true;
  if (!isKnownRole(role)) return false;
  return MATRIX[role].includes(cap);
}

export function hasAnyCapability(role: string | null | undefined, caps: Capability[]): boolean {
  return caps.some((c) => hasCapability(role, c));
}

/** ¿Este rol tiene algún acceso al backoffice? */
export function canAccessBackoffice(role: string | null | undefined): boolean {
  return capabilitiesFor(role).length > 0;
}

/**
 * Nombre legible de cada capacidad. Se usa para explicar *por qué* no se ve
 * algo: "tu rol no incluye Reembolsos" dice más que un 403 o un menú corto.
 */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  'dashboard.view': 'Resumen de operación',
  'events.view': 'Ver eventos',
  'events.manage': 'Crear y editar eventos',
  'orders.view': 'Ver órdenes',
  'orders.refund': 'Reembolsar órdenes',
  'venues.view': 'Ver recintos',
  'venues.editMap': 'Editar mapas de butacas',
  'inventory.operate': 'Operar inventario',
  'inventory.monitor': 'Monitor de venta en vivo',
  'analytics.view': 'Analítica',
  'reports.view': 'Reportes',
  'finance.view': 'Finanzas y liquidaciones',
  'marketing.manage': 'Marketing y canales',
  'access.scan': 'Escaneo de acceso',
  'boxoffice.operate': 'Taquilla',
  'org.manage': 'Administración de la organización',
  'audit.view': 'Bitácora de auditoría',
  'settings.payments': 'Configuración de pagos',
  'settings.branding': 'Marca',
  'safety.view': 'Seguridad y egress',
  'risk.view': 'Riesgo y fraude',
};

/**
 * Roles que sí tienen una capacidad dada. Sirve para decirle al usuario a quién
 * pedirle acceso en lugar de dejarlo adivinando.
 */
export function rolesWithCapability(cap: Capability): Role[] {
  return (Object.keys(MATRIX) as Role[]).filter(
    (r) => r !== 'CUSTOMER' && (r === 'SUPER_ADMIN' || MATRIX[r].includes(cap)),
  );
}

/** Etiqueta legible del rol para la interfaz. */
export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super administrador',
  ADMIN: 'Administrador',
  PROMOTER: 'Promotor',
  VENUE_MANAGER: 'Gestor de recinto',
  TAQUILLA: 'Taquilla',
  SCANNER: 'Control de acceso',
  ARTIST: 'Artista',
  CUSTOMER: 'Cliente',
};

/**
 * Roles que se pueden invitar desde el producto.
 * Espejo de `INVITABLE_ROLES` en `apps/api/src/modules/auth/invitations.service.ts`;
 * el API rechaza cualquier otro con 400.
 */
export const INVITABLE_ROLES: Role[] = [
  'SCANNER',
  'TAQUILLA',
  'ARTIST',
  'VENUE_MANAGER',
  'PROMOTER',
  'ADMIN',
];

/**
 * Jerarquía de roles — espejo de `ROLE_RANK` en el API.
 * Nadie puede invitar por encima de su propio rango.
 */
const ROLE_RANK: Record<Role, number> = {
  CUSTOMER: 0,
  SCANNER: 1,
  TAQUILLA: 2,
  ARTIST: 2,
  VENUE_MANAGER: 3,
  PROMOTER: 4,
  ADMIN: 5,
  SUPER_ADMIN: 6,
};

/** Roles que `inviterRole` puede otorgar (el API valida lo mismo). */
export function invitableRolesFor(inviterRole: string | null | undefined): Role[] {
  const rank = isKnownRole(inviterRole) ? ROLE_RANK[inviterRole] : 0;
  return INVITABLE_ROLES.filter((r) => ROLE_RANK[r] <= rank);
}
