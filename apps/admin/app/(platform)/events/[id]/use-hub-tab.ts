'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { parseHubTab, type HubTab } from './tabs';

export function useHubTab(): [HubTab, (next: HubTab) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tab = useMemo(
    () => parseHubTab(searchParams.get('tab')),
    [searchParams],
  );

  const setTab = useCallback(
    (next: HubTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'overview') {
        params.delete('tab');
      } else {
        params.set('tab', next);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return [tab, setTab];
}
