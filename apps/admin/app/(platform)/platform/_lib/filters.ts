import type { CapabilityGroup, CapabilityState } from './catalog';

export const CAPABILITY_STATE_FILTERS = ['todas', 'activas', 'sin-uso', 'inactivas'] as const;
export type CapabilityStateFilter = (typeof CAPABILITY_STATE_FILTERS)[number];

export const DELIVERY_FILTERS = ['pendientes', 'todas'] as const;
export type DeliveryFilter = (typeof DELIVERY_FILTERS)[number];

const STATE_BY_FILTER: Readonly<Record<Exclude<CapabilityStateFilter, 'todas'>, CapabilityState>> =
  {
    activas: 'active',
    'sin-uso': 'idle',
    inactivas: 'off',
  };

export function isCapabilityStateFilter(value: string): value is CapabilityStateFilter {
  return (CAPABILITY_STATE_FILTERS as readonly string[]).includes(value);
}

export function isDeliveryFilter(value: string): value is DeliveryFilter {
  return (DELIVERY_FILTERS as readonly string[]).includes(value);
}

/** Búsqueda tolerante a acentos y mayúsculas. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export interface CapabilityFilters {
  query: string;
  groupIds: readonly string[];
  state: CapabilityStateFilter;
}

/**
 * Aplica los filtros de la URL y descarta los grupos que se quedan vacíos.
 * Los contadores se recalculan sobre lo visible para que el resumen de cada
 * tarjeta coincida siempre con las filas en pantalla.
 */
export function filterCapabilityGroups(
  groups: readonly CapabilityGroup[],
  filters: CapabilityFilters,
): CapabilityGroup[] {
  const needle = normalize(filters.query.trim());
  const wanted = filters.state === 'todas' ? null : STATE_BY_FILTER[filters.state];

  return groups.flatMap((group) => {
    if (filters.groupIds.length > 0 && !filters.groupIds.includes(group.id)) return [];

    const items = group.items.filter((item) => {
      if (wanted && item.state !== wanted) return false;
      if (!needle) return true;
      const haystack = normalize(`${item.label} ${item.summary} ${item.key} ${item.stateLabel}`);
      return haystack.includes(needle);
    });

    if (items.length === 0) return [];
    return [
      {
        ...group,
        items,
        activeCount: items.filter((item) => item.enabled).length,
      },
    ];
  });
}

export function countVisibleCapabilities(groups: readonly CapabilityGroup[]): number {
  return groups.reduce((total, group) => total + group.items.length, 0);
}
