'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { FilterSelection } from '@boletera/ui';
import type { HealthStatus, MapFilter, ViewMode } from './types';

const HEALTH_VALUES = new Set<HealthStatus>([
  'ok',
  'warn',
  'critical',
  'no-network',
  'empty',
]);

const MAP_VALUES = new Set<MapFilter>(['with', 'without']);

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function isHealth(value: string): value is HealthStatus {
  return HEALTH_VALUES.has(value as HealthStatus);
}

function isMapFilter(value: string): value is MapFilter {
  return MAP_VALUES.has(value as MapFilter);
}

function isViewMode(value: string): value is ViewMode {
  return value === 'table' || value === 'cards';
}

export type VenuesUrlState = {
  q: string;
  health: readonly HealthStatus[];
  maps: readonly MapFilter[];
  cities: readonly string[];
  view: ViewMode;
  selectedId: string | null;
  filterSelection: FilterSelection;
};

/**
 * Filtros del portafolio sincronizados con la URL (fuente de verdad única).
 */
export function useVenuesUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<VenuesUrlState>(() => {
    const q = searchParams.get('q') ?? '';
    const health = parseList(searchParams.get('health')).filter(isHealth);
    const maps = parseList(searchParams.get('map')).filter(isMapFilter);
    const cities = parseList(searchParams.get('city'));
    const viewRaw = searchParams.get('view') ?? 'table';
    const view: ViewMode = isViewMode(viewRaw) ? viewRaw : 'table';
    const selectedId = searchParams.get('venue');

    const filterSelection: FilterSelection = {
      ...(health.length ? { health } : {}),
      ...(maps.length ? { map: maps } : {}),
      ...(cities.length ? { city: cities } : {}),
    };

    return {
      q,
      health,
      maps,
      cities,
      view,
      selectedId: selectedId && selectedId.trim() ? selectedId : null,
      filterSelection,
    };
  }, [searchParams]);

  const replaceParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === '') next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setSearch = useCallback(
    (q: string) => replaceParams({ q: q || null }),
    [replaceParams],
  );

  const setFilterSelection = useCallback(
    (selection: FilterSelection) => {
      replaceParams({
        health: selection.health?.length ? selection.health.join(',') : null,
        map: selection.map?.length ? selection.map.join(',') : null,
        city: selection.city?.length ? selection.city.join(',') : null,
      });
    },
    [replaceParams],
  );

  const setView = useCallback(
    (view: ViewMode) => replaceParams({ view: view === 'table' ? null : view }),
    [replaceParams],
  );

  const setSelectedId = useCallback(
    (venueId: string | null) => replaceParams({ venue: venueId }),
    [replaceParams],
  );

  const clearFilters = useCallback(() => {
    replaceParams({
      q: null,
      health: null,
      map: null,
      city: null,
    });
  }, [replaceParams]);

  return {
    ...state,
    setSearch,
    setFilterSelection,
    setView,
    setSelectedId,
    clearFilters,
  };
}
