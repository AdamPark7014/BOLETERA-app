'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { IntegrationKind } from '@/lib/queries/integrations';

const KIND_VALUES = new Set<string>(['banorte', 'email', 'webhooks']);

function isKind(value: string): value is IntegrationKind {
  return KIND_VALUES.has(value);
}

export type IntegrationsUrlState = {
  selectedId: IntegrationKind | null;
  filter: 'all' | 'needsSetup' | 'healthy';
};

export function useIntegrationsUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<IntegrationsUrlState>(() => {
    const selectedRaw = searchParams.get('connector');
    const filterRaw = searchParams.get('filter') ?? 'all';
    const filter: IntegrationsUrlState['filter'] =
      filterRaw === 'needsSetup' || filterRaw === 'healthy' ? filterRaw : 'all';
    return {
      selectedId: selectedRaw && isKind(selectedRaw) ? selectedRaw : null,
      filter,
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

  const setSelectedId = useCallback(
    (id: IntegrationKind | null) => replaceParams({ connector: id }),
    [replaceParams],
  );

  const setFilter = useCallback(
    (filter: IntegrationsUrlState['filter']) =>
      replaceParams({ filter: filter === 'all' ? null : filter }),
    [replaceParams],
  );

  return { ...state, setSelectedId, setFilter };
}
