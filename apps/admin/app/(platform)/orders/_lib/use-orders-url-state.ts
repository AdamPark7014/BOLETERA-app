'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { FilterSelection } from '@boletera/ui/src/components/FilterBar';
import { isMetricsRangeKey, isOrderStatus, isSalesChannel } from './format';
import type { MetricsRangeKey } from './types';

export type OrdersUrlState = {
  q: string;
  statuses: readonly string[];
  channels: readonly string[];
  range: MetricsRangeKey;
  filterSelection: FilterSelection;
};

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Single source of truth for list filters: the URL search string.
 * UI state is derived — never mirrored in a parallel useState.
 */
export function useOrdersUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<OrdersUrlState>(() => {
    const q = searchParams.get('q') ?? '';
    const statuses = parseList(searchParams.get('status')).filter(isOrderStatus);
    const channels = parseList(searchParams.get('channel')).filter(isSalesChannel);
    const rangeRaw = searchParams.get('range') ?? '30d';
    const range: MetricsRangeKey = isMetricsRangeKey(rangeRaw) ? rangeRaw : '30d';

    const filterSelection: FilterSelection = {
      ...(statuses.length ? { status: statuses } : {}),
      ...(channels.length ? { channel: channels } : {}),
    };

    return { q, statuses, channels, range, filterSelection };
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
        status: selection.status?.length ? selection.status.join(',') : null,
        channel: selection.channel?.length ? selection.channel.join(',') : null,
      });
    },
    [replaceParams],
  );

  const setRange = useCallback(
    (range: MetricsRangeKey) => replaceParams({ range }),
    [replaceParams],
  );

  return {
    ...state,
    setSearch,
    setFilterSelection,
    setRange,
  };
}
