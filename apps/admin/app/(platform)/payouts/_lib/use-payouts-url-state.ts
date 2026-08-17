'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { FilterSelection } from '@boletera/ui';
import { isPayoutStatus } from './payouts';
import { isSettlementPeriod } from './period';
import type { PayoutStatus, SettlementPeriod } from './types';

export type PayoutsUrlState = {
  period: SettlementPeriod;
  statuses: readonly PayoutStatus[];
  q: string;
  /** Liquidación abierta en el panel lateral. */
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

/**
 * La URL es la única fuente de verdad de los filtros: un enlace compartido
 * reproduce exactamente la misma vista de tesorería.
 */
export function usePayoutsUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<PayoutsUrlState>(() => {
    const periodRaw = searchParams.get('period') ?? 'MONTHLY';
    const period: SettlementPeriod = isSettlementPeriod(periodRaw) ? periodRaw : 'MONTHLY';
    const statuses = parseList(searchParams.get('status')).filter(isPayoutStatus);
    const filterSelection: FilterSelection =
      statuses.length > 0 ? { status: statuses } : {};
    return {
      period,
      statuses,
      q: searchParams.get('q') ?? '',
      selectedId: searchParams.get('payout'),
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

  const setPeriod = useCallback(
    (period: SettlementPeriod) => replaceParams({ period }),
    [replaceParams],
  );

  const setSearch = useCallback((q: string) => replaceParams({ q: q || null }), [replaceParams]);

  const setFilterSelection = useCallback(
    (selection: FilterSelection) => {
      const statuses = selection.status ?? [];
      replaceParams({ status: statuses.length ? statuses.join(',') : null });
    },
    [replaceParams],
  );

  const setSelectedId = useCallback(
    (payoutId: string | null) => replaceParams({ payout: payoutId }),
    [replaceParams],
  );

  return { ...state, setPeriod, setSearch, setFilterSelection, setSelectedId };
}
