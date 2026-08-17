'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MetricsAlert } from '@boletera/shared';
import { useMetricsAlerts } from '@/lib/queries';
import { readReadAlertIds, writeReadAlertIds } from './storage';
import { sortAlerts } from './alert-routes';

export type AlertsState = {
  alerts: MetricsAlert[];
  unread: MetricsAlert[];
  unreadCount: number;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  isRead: (id: string) => boolean;
};

/**
 * Owns the alerts query so Topbar chrome outside the notifications panel
 * only receives a stable unreadCount via props when needed.
 */
export function useShellAlerts(): AlertsState {
  const query = useMetricsAlerts();
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setReadIds(new Set(readReadAlertIds()));
  }, []);

  const alerts = useMemo(
    () => sortAlerts(query.data?.alerts ?? []),
    [query.data?.alerts],
  );

  const isRead = useCallback((id: string) => readIds.has(id), [readIds]);

  const unread = useMemo(
    () => alerts.filter((alert) => !readIds.has(alert.id)),
    [alerts, readIds],
  );

  const markRead = useCallback((id: string) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      writeReadAlertIds([...next]);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const alert of alerts) next.add(alert.id);
      writeReadAlertIds([...next]);
      return next;
    });
  }, [alerts]);

  return {
    alerts,
    unread,
    unreadCount: unread.length,
    isPending: query.isPending,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
    markRead,
    markAllRead,
    isRead,
  };
}
