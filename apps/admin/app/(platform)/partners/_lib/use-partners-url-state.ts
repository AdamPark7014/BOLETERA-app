'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { FilterSelection } from '@boletera/ui';
import type { HealthFilter, KeyHealth } from './keys';
import { HEALTH_FILTER_OPTIONS } from './keys';

export type PartnersUrlState = {
  q: string;
  health: HealthFilter;
  selectedId: string | null;
  filterSelection: FilterSelection;
};

const HEALTH_VALUES = new Set<string>(HEALTH_FILTER_OPTIONS.map((option) => option.value));

function isHealthFilter(value: string): value is HealthFilter {
  return HEALTH_VALUES.has(value);
}

function isKeyHealth(value: string): value is KeyHealth {
  return value !== 'all' && isHealthFilter(value);
}

/**
 * La URL es la única fuente de verdad de búsqueda, filtro de salud y detalle
 * abierto: un enlace compartido reproduce exactamente la misma vista.
 */
export function usePartnersUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<PartnersUrlState>(() => {
    const healthRaw = searchParams.get('health') ?? 'all';
    const health: HealthFilter = isHealthFilter(healthRaw) ? healthRaw : 'all';
    const filterDraft: Record<string, readonly string[]> = {};
    if (health !== 'all') filterDraft.health = [health];
    const filterSelection: FilterSelection = filterDraft;
    return {
      q: searchParams.get('q') ?? '',
      health,
      selectedId: searchParams.get('key'),
      filterSelection,
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

  const setSearch = useCallback((q: string) => replaceParams({ q: q || null }), [replaceParams]);

  const setHealth = useCallback(
    (health: HealthFilter) => replaceParams({ health: health === 'all' ? null : health }),
    [replaceParams],
  );

  const setFilterSelection = useCallback(
    (selection: FilterSelection) => {
      const next = selection.health?.[0];
      replaceParams({
        health: next && isKeyHealth(next) ? next : null,
      });
    },
    [replaceParams],
  );

  const setSelectedId = useCallback(
    (keyId: string | null) => replaceParams({ key: keyId }),
    [replaceParams],
  );

  const clearFilters = useCallback(
    () => replaceParams({ q: null, health: null }),
    [replaceParams],
  );

  return { ...state, setSearch, setHealth, setFilterSelection, setSelectedId, clearFilters };
}
