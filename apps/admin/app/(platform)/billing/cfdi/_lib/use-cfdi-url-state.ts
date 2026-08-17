'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { FilterSelection } from '@boletera/ui';
import type { InvoiceFilter } from './invoices';

function isInvoiceFilter(value: string): value is Exclude<InvoiceFilter, 'ALL'> {
  return value === 'OK' || value === 'ERROR' || value === 'PENDING';
}

export type CfdiUrlState = {
  filter: InvoiceFilter;
  q: string;
  filterSelection: FilterSelection;
};

/**
 * Filtros de CFDI en la URL para compartir el mismo inventario fiscal.
 */
export function useCfdiUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<CfdiUrlState>(() => {
    const raw = searchParams.get('status') ?? 'ALL';
    const filter: InvoiceFilter =
      raw === 'ALL' || isInvoiceFilter(raw) ? (raw as InvoiceFilter) : 'ALL';
    const filterSelection: FilterSelection =
      filter === 'ALL' ? {} : { status: [filter] };
    return {
      filter,
      q: searchParams.get('q') ?? '',
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

  const setSearch = useCallback(
    (q: string) => replaceParams({ q: q || null }),
    [replaceParams],
  );

  const setFilterSelection = useCallback(
    (selection: FilterSelection) => {
      const statuses = selection.status ?? [];
      const next = statuses[0];
      replaceParams({
        status: next && isInvoiceFilter(next) ? next : null,
      });
    },
    [replaceParams],
  );

  return { ...state, setSearch, setFilterSelection };
}
