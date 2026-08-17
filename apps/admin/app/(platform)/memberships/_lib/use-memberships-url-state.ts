'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  SORT_OPTIONS,
  STATUS_FILTER_OPTIONS,
  type SortKey,
  type StatusFilter,
} from './plans';

export type MembershipsUrlState = {
  q: string;
  status: StatusFilter;
  sort: SortKey;
  tab: 'tiers' | 'renewals';
};

const STATUS_VALUES = new Set<string>(STATUS_FILTER_OPTIONS.map((o) => o.value));
const SORT_VALUES = new Set<string>(SORT_OPTIONS.map((o) => o.value));
const TAB_VALUES = new Set(['tiers', 'renewals']);

function isStatusFilter(value: string): value is StatusFilter {
  return STATUS_VALUES.has(value);
}

function isSortKey(value: string): value is SortKey {
  return SORT_VALUES.has(value);
}

function isTab(value: string): value is MembershipsUrlState['tab'] {
  return TAB_VALUES.has(value);
}

export function useMembershipsUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<MembershipsUrlState>(() => {
    const statusRaw = searchParams.get('status') ?? 'all';
    const sortRaw = searchParams.get('sort') ?? 'members';
    const tabRaw = searchParams.get('tab') ?? 'tiers';
    return {
      q: searchParams.get('q') ?? '',
      status: isStatusFilter(statusRaw) ? statusRaw : 'all',
      sort: isSortKey(sortRaw) ? sortRaw : 'members',
      tab: isTab(tabRaw) ? tabRaw : 'tiers',
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

  return {
    ...state,
    setSearch: useCallback(
      (q: string) => replaceParams({ q: q || null }),
      [replaceParams],
    ),
    setStatus: useCallback(
      (status: StatusFilter) =>
        replaceParams({ status: status === 'all' ? null : status }),
      [replaceParams],
    ),
    setSort: useCallback(
      (sort: SortKey) => replaceParams({ sort: sort === 'members' ? null : sort }),
      [replaceParams],
    ),
    setTab: useCallback(
      (tab: MembershipsUrlState['tab']) =>
        replaceParams({ tab: tab === 'tiers' ? null : tab }),
      [replaceParams],
    ),
    clearFilters: useCallback(
      () => replaceParams({ q: null, status: null, sort: null }),
      [replaceParams],
    ),
  };
}
