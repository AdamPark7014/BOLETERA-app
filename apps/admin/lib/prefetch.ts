'use client';

import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { http } from './http';
import { queryKeys } from './query-keys';
import { useSession } from './use-session';
import type { EventRow, PlatformOverview } from './platform-api';
import type { OrderRow } from './queries/orders';
import type { VenueRow } from './queries/venues';

export function prefetchAdminRoute(
  client: QueryClient,
  href: string,
  organizationId: string | null,
): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (href === '/dashboard') {
    tasks.push(
      client.prefetchQuery({
        queryKey: queryKeys.overview.platform(),
        queryFn: ({ signal }) =>
          http<PlatformOverview>('/admin/platform/overview', { signal }),
      }),
    );
  } else if (href === '/events' || href === '/calendar') {
    tasks.push(
      client.prefetchQuery({
        queryKey: queryKeys.events.list(),
        queryFn: ({ signal }) => http<EventRow[]>('/admin/events', { signal }),
      }),
    );
  } else if (href === '/orders') {
    tasks.push(
      client.prefetchQuery({
        queryKey: queryKeys.orders.list(),
        queryFn: ({ signal }) => http<OrderRow[]>('/admin/orders', { signal }),
      }),
    );
  } else if (href === '/maps') {
    tasks.push(
      client.prefetchQuery({
        queryKey: queryKeys.venues.list(),
        queryFn: ({ signal }) => http<VenueRow[]>('/admin/venues', { signal }),
      }),
    );
  } else if (href === '/settings/organization' && organizationId) {
    tasks.push(
      client.prefetchQuery({
        queryKey: queryKeys.organization.detail(organizationId),
        queryFn: ({ signal }) =>
          http<Record<string, unknown>>(`/organization/${organizationId}`, { signal }),
      }),
    );
  }
  return Promise.all(tasks).then(() => undefined);
}

export function usePrefetchNavigation() {
  const client = useQueryClient();
  const { organizationId } = useSession();
  const prefetch = useCallback(
    (href: string) => prefetchAdminRoute(client, href, organizationId),
    [client, organizationId],
  );
  const linkProps = useCallback(
    (href: string) => ({
      onMouseEnter: () => {
        void prefetch(href);
      },
      onFocus: () => {
        void prefetch(href);
      },
    }),
    [prefetch],
  );
  return { prefetch, linkProps };
}
