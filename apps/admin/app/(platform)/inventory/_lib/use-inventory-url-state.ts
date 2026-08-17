'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { FilterSelection } from '@boletera/ui';
import { isRangeKey } from './format';
import { PRESSURE_VALUES, type PressureLevel, type RangeKey } from './types';

export type InventoryUrlState = {
  range: RangeKey;
  q: string;
  eventId: string | null;
  venueId: string | null;
  pressures: readonly PressureLevel[];
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

function isPressure(value: string): value is PressureLevel {
  return (PRESSURE_VALUES as readonly string[]).includes(value);
}

/** URL is the source of truth for inventory filters and selection. */
export function useInventoryUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<InventoryUrlState>(() => {
    const rangeRaw = searchParams.get('range') ?? '90';
    const range: RangeKey = isRangeKey(rangeRaw) ? rangeRaw : '90';
    const pressures = parseList(searchParams.get('pressure')).filter(isPressure);
    const filterSelection: FilterSelection =
      pressures.length > 0 ? { pressure: pressures } : {};
    return {
      range,
      q: searchParams.get('q') ?? '',
      eventId: searchParams.get('event'),
      venueId: searchParams.get('venue'),
      pressures,
      selectedId: searchParams.get('zone'),
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
    setEventId: useCallback(
      (eventId: string | null) => replaceParams({ event: eventId }),
      [replaceParams],
    ),
    setVenueId: useCallback(
      (venueId: string | null) => replaceParams({ venue: venueId, event: null }),
      [replaceParams],
    ),
    setFilterSelection: useCallback(
      (selection: FilterSelection) => {
        const pressures = selection.pressure ?? [];
        replaceParams({ pressure: pressures.length ? pressures.join(',') : null });
      },
      [replaceParams],
    ),
    setSelectedId: useCallback(
      (zoneId: string | null) => replaceParams({ zone: zoneId }),
      [replaceParams],
    ),
    clearFilters: useCallback(
      () =>
        replaceParams({
          q: null,
          pressure: null,
          event: null,
          venue: null,
        }),
      [replaceParams],
    ),
  };
}
