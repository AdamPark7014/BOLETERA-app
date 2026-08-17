'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { MemberStatusFilter } from './team';
import { isOrgTab, type OrgTab } from './types';

export type OrgUrlState = {
  tab: OrgTab;
  q: string;
  status: MemberStatusFilter;
  role: string;
};

function isMemberStatus(value: string): value is MemberStatusFilter {
  return value === 'all' || value === 'active' || value === 'inactive';
}

/** Tabs y filtros del equipo sincronizados con la URL. */
export function useOrgUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<OrgUrlState>(() => {
    const tabRaw = searchParams.get('tab') ?? 'profile';
    const statusRaw = searchParams.get('status') ?? 'all';
    return {
      tab: isOrgTab(tabRaw) ? tabRaw : 'profile',
      q: searchParams.get('q') ?? '',
      status: isMemberStatus(statusRaw) ? statusRaw : 'all',
      role: searchParams.get('role') ?? 'all',
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

  const setTab = useCallback(
    (tab: OrgTab) => replaceParams({ tab: tab === 'profile' ? null : tab }),
    [replaceParams],
  );

  const setSearch = useCallback((q: string) => replaceParams({ q: q || null }), [replaceParams]);

  const setStatus = useCallback(
    (status: MemberStatusFilter) =>
      replaceParams({ status: status === 'all' ? null : status }),
    [replaceParams],
  );

  const setRole = useCallback(
    (role: string) => replaceParams({ role: role === 'all' ? null : role }),
    [replaceParams],
  );

  const clearTeamFilters = useCallback(
    () => replaceParams({ q: null, status: null, role: null }),
    [replaceParams],
  );

  return { ...state, setTab, setSearch, setStatus, setRole, clearTeamFilters };
}
