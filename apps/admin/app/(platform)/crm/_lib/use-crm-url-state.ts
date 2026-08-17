'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { FilterSelection } from '@boletera/ui';
import type { CrmRangeKey, CustomerSegment } from './types';

const RANGE_VALUES = new Set<string>(['30', '90', '365']);
const SEGMENT_VALUES = new Set<string>([
  'vip',
  'recurrent',
  'new',
  'at_risk',
  'inactive',
]);

function isRange(value: string): value is CrmRangeKey {
  return RANGE_VALUES.has(value);
}

function isSegment(value: string): value is CustomerSegment {
  return SEGMENT_VALUES.has(value);
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export type CrmUrlState = {
  range: CrmRangeKey;
  q: string;
  segments: readonly CustomerSegment[];
  channels: readonly string[];
  selectedId: string | null;
  filterSelection: FilterSelection;
};

/**
 * URL como fuente de verdad: rango, búsqueda, segmentos, canales y perfil abierto.
 */
export function useCrmUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<CrmUrlState>(() => {
    const rangeRaw = searchParams.get('range') ?? '90';
    const range: CrmRangeKey = isRange(rangeRaw) ? rangeRaw : '90';
    const segments = parseList(searchParams.get('segment')).filter(isSegment);
    const channels = parseList(searchParams.get('channel'));
    const filterSelection: FilterSelection = {
      ...(segments.length > 0 ? { segment: [...segments] } : {}),
      ...(channels.length > 0 ? { channel: [...channels] } : {}),
    };

    return {
      range,
      q: searchParams.get('q') ?? '',
      segments,
      channels,
      selectedId: searchParams.get('customer'),
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

  const setRange = useCallback(
    (range: CrmRangeKey) => replaceParams({ range: range === '90' ? null : range }),
    [replaceParams],
  );

  const setSearch = useCallback(
    (q: string) => replaceParams({ q: q || null }),
    [replaceParams],
  );

  const setFilterSelection = useCallback(
    (selection: FilterSelection) => {
      const segments = selection.segment?.filter(isSegment) ?? [];
      const channels = selection.channel ?? [];
      replaceParams({
        segment: segments.length ? segments.join(',') : null,
        channel: channels.length ? channels.join(',') : null,
      });
    },
    [replaceParams],
  );

  const toggleSegment = useCallback(
    (segment: CustomerSegment) => {
      const current = new Set(state.segments);
      if (current.has(segment)) current.delete(segment);
      else current.add(segment);
      const next = [...current];
      replaceParams({ segment: next.length ? next.join(',') : null });
    },
    [replaceParams, state.segments],
  );

  const setSelectedId = useCallback(
    (customerId: string | null) =>
      replaceParams({ customer: customerId }),
    [replaceParams],
  );

  const clearFilters = useCallback(
    () => replaceParams({ q: null, segment: null, channel: null }),
    [replaceParams],
  );

  return {
    ...state,
    setRange,
    setSearch,
    setFilterSelection,
    toggleSegment,
    setSelectedId,
    clearFilters,
  };
}
