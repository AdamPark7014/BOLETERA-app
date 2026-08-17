'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { FilterSelection } from '@boletera/ui';
import { CAPABILITY_GROUPS } from './catalog';
import {
  isCapabilityStateFilter,
  isDeliveryFilter,
  type CapabilityStateFilter,
  type DeliveryFilter,
} from './filters';

const GROUP_IDS: readonly string[] = CAPABILITY_GROUPS.map((group) => group.id);

function parseGroups(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => GROUP_IDS.includes(part));
}

export interface PlanUrlState {
  query: string;
  groupIds: readonly string[];
  state: CapabilityStateFilter;
  deliveries: DeliveryFilter;
  filterSelection: FilterSelection;
  hasFilters: boolean;
}

/**
 * La URL es la única fuente de verdad de los filtros: se puede compartir el
 * enlace de "capacidades contratadas sin uso" tal cual.
 */
export function usePlanUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<PlanUrlState>(() => {
    const query = searchParams.get('q') ?? '';
    const groupIds = parseGroups(searchParams.get('grupo'));
    const rawState = searchParams.get('estado') ?? '';
    const rawDeliveries = searchParams.get('entregas') ?? '';
    const capabilityState: CapabilityStateFilter = isCapabilityStateFilter(rawState)
      ? rawState
      : 'todas';
    const deliveries: DeliveryFilter = isDeliveryFilter(rawDeliveries)
      ? rawDeliveries
      : 'pendientes';

    let filterSelection: FilterSelection = {};
    if (groupIds.length > 0) {
      filterSelection = { grupo: groupIds };
    }

    return {
      query,
      groupIds,
      state: capabilityState,
      deliveries,
      filterSelection,
      hasFilters: query.trim().length > 0 || groupIds.length > 0 || capabilityState !== 'todas',
    };
  }, [searchParams]);

  const replaceParams = useCallback(
    (patch: Readonly<Record<string, string | null>>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setQuery = useCallback(
    (value: string) => replaceParams({ q: value || null }),
    [replaceParams],
  );

  const setFilterSelection = useCallback(
    (selection: FilterSelection) => {
      const groups = selection.grupo ?? [];
      replaceParams({ grupo: groups.length > 0 ? groups.join(',') : null });
    },
    [replaceParams],
  );

  const setState = useCallback(
    (value: CapabilityStateFilter) => replaceParams({ estado: value === 'todas' ? null : value }),
    [replaceParams],
  );

  const setDeliveries = useCallback(
    (value: DeliveryFilter) =>
      replaceParams({ entregas: value === 'pendientes' ? null : value }),
    [replaceParams],
  );

  const clearFilters = useCallback(
    () => replaceParams({ q: null, grupo: null, estado: null }),
    [replaceParams],
  );

  return {
    ...state,
    setQuery,
    setFilterSelection,
    setState,
    setDeliveries,
    clearFilters,
  };
}
