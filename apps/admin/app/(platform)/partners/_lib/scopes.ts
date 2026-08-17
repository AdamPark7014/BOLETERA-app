/**
 * Catálogo de scopes de API.
 *
 * La lista concedible replica exactamente `API_SCOPES` de
 * `apps/api/src/modules/partners/partners.dto.ts`: el DTO valida con `@IsIn`,
 * así que ofrecer un scope fuera de esa lista produce un 400 al crear la clave.
 * Las claves existentes sí pueden llevar scopes heredados, por eso el formateo
 * acepta cualquier cadena.
 */

/** Scopes que el backend acepta hoy al emitir una clave. */
export const GRANTABLE_SCOPES = ['read:events', 'read:inventory', 'write:orders'] as const;

export type GrantableScope = (typeof GRANTABLE_SCOPES)[number];

/** `write:*` concede mutación; se pondera distinto en la postura de seguridad. */
export type ScopeRisk = 'read' | 'write';

export type ScopeMeta = {
  id: GrantableScope;
  label: string;
  hint: string;
  risk: ScopeRisk;
};

export const SCOPE_CATALOG: readonly ScopeMeta[] = [
  {
    id: 'read:events',
    label: 'Leer eventos',
    hint: 'Catálogo, horarios y estado de publicación.',
    risk: 'read',
  },
  {
    id: 'read:inventory',
    label: 'Leer inventario',
    hint: 'Disponibilidad, aforo y zonas.',
    risk: 'read',
  },
  {
    id: 'write:orders',
    label: 'Escribir órdenes',
    hint: 'Crear y confirmar ventas en nombre de la organización.',
    risk: 'write',
  },
];

const SCOPE_BY_ID = new Map<string, ScopeMeta>(SCOPE_CATALOG.map((scope) => [scope.id, scope]));

export function isGrantableScope(value: string): value is GrantableScope {
  return SCOPE_BY_ID.has(value);
}

/** Etiqueta legible; devuelve el identificador crudo para scopes heredados. */
export function scopeLabel(scope: string): string {
  return SCOPE_BY_ID.get(scope)?.label ?? scope;
}

/** El comodín `*` que emite el guard de la API también cuenta como escritura. */
export function isWriteScope(scope: string): boolean {
  return scope === '*' || scope.startsWith('write:');
}

export function countWriteScopes(scopes: readonly string[]): number {
  return scopes.filter(isWriteScope).length;
}
