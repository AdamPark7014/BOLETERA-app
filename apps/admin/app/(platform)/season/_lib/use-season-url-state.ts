'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  SORT_OPTIONS,
  STATUS_FILTER_OPTIONS,
  type SortKey,
  type StatusFilter,
} from './passes';

export type SeasonUrlState = {
  q: string;
  season: string;
  status: StatusFilter;
  sort: SortKey;
};

const STATUS_VALUES = new Set<string>(STATUS_FILTER_OPTIONS.map((option) => option.value));
const SORT_VALUES = new Set<string>(SORT_OPTIONS.map((option) => option.value));

function isStatusFilter(value: string): value is StatusFilter {
  return STATUS_VALUES.has(value);
}

function isSortKey(value: string): value is SortKey {
  return SORT_VALUES.has(value);
}

/** Filtros y ordenamiento persistidos en la URL para vistas compartibles. */
export function useSeasonUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<SeasonUrlState>(() => {
    const statusRaw = searchParams.get('status') ?? 'all';
    const sortRaw = searchParams.get('sort') ?? 'adoption';
    return {
      q: searchParams.get('q') ?? '',
      season: searchParams.get('season') ?? 'all',
      status: isStatusFilter(statusRaw) ? statusRaw : 'all',
      sort: isSortKey(sortRaw) ? sortRaw : 'adoption',
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

  const setSeason = useCallback(
    (season: string) => replaceParams({ season: season === 'all' ? null : season }),
    [replaceParams],
  );

  const setStatus = useCallback(
    (status: StatusFilter) => replaceParams({ status: status === 'all' ? null : status }),
    [replaceParams],
  );

  const setSort = useCallback(
    (sort: SortKey) => replaceParams({ sort: sort === 'adoption' ? null : sort }),
    [replaceParams],
  );

  const clearFilters = useCallback(
    () => replaceParams({ q: null, season: null, status: null, sort: null }),
    [replaceParams],
  );

  return { ...state, setSearch, setSeason, setStatus, setSort, clearFilters };
}
