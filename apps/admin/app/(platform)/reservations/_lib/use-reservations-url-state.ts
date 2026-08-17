'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { FilterSelection } from '@boletera/ui';
import { isRangeKey } from './format';
import {
  KIND_VALUES,
  STATUS_VALUES,
  type RangeKey,
  type ReservationKind,
  type ReservationStatus,
} from './types';

export type ReservationsUrlState = {
  range: RangeKey;
  q: string;
  kinds: readonly ReservationKind[];
  statuses: readonly ReservationStatus[];
  selectedId: string | null;
  filterSelection: FilterSelection;
};

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function isKind(value: string): value is ReservationKind {
  return (KIND_VALUES as readonly string[]).includes(value);
}

function isStatus(value: string): value is ReservationStatus {
  return (STATUS_VALUES as readonly string[]).includes(value);
}

export function useReservationsUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<ReservationsUrlState>(() => {
    const rangeRaw = searchParams.get('range') ?? '90';
    const range: RangeKey = isRangeKey(rangeRaw) ? rangeRaw : '90';
    const kinds = parseList(searchParams.get('kind')).filter(isKind);
    const statuses = parseList(searchParams.get('status')).filter(isStatus);
    const filterSelection: FilterSelection = {
      ...(kinds.length ? { kind: kinds } : {}),
      ...(statuses.length ? { status: statuses } : {}),
    };
    return {
      range,
      q: searchParams.get('q') ?? '',
      kinds,
      statuses,
      selectedId: searchParams.get('hold'),
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

  return {
    ...state,
    setRange: useCallback(
      (range: RangeKey) => replaceParams({ range }),
      [replaceParams],
    ),
    setSearch: useCallback((q: string) => replaceParams({ q: q || null }), [replaceParams]),
    setFilterSelection: useCallback(
      (selection: FilterSelection) => {
        const kinds = selection.kind ?? [];
        const statuses = selection.status ?? [];
        replaceParams({
          kind: kinds.length ? kinds.join(',') : null,
          status: statuses.length ? statuses.join(',') : null,
        });
      },
      [replaceParams],
    ),
    setSelectedId: useCallback(
      (holdId: string | null) => replaceParams({ hold: holdId }),
      [replaceParams],
    ),
    clearFilters: useCallback(
      () => replaceParams({ q: null, kind: null, status: null }),
      [replaceParams],
    ),
  };
}
