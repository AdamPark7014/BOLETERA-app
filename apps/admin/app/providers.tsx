'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider as UiToastProvider } from '@boletera/ui';
import { SessionProvider } from '@/lib/use-session';
import { isRetryableError } from '@/lib/http';
import { queryKeys } from '@/lib/query-keys';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2 * 60_000,
        gcTime: 30 * 60_000,
        retry: (failureCount, error) => failureCount < 3 && isRetryableError(error),
        retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 30_000),
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: (failureCount, error) => failureCount < 1 && isRetryableError(error),
        retryDelay: 1_000,
      },
    },
  });

  client.setQueryDefaults(queryKeys.events.all, { staleTime: 60_000 });
  client.setQueryDefaults(queryKeys.orders.all, {
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  client.setQueryDefaults(queryKeys.analytics.all, {
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  client.setQueryDefaults(queryKeys.venues.all, { staleTime: 10 * 60_000 });
  client.setQueryDefaults(queryKeys.organization.all, { staleTime: 10 * 60_000 });
  client.setQueryDefaults(queryKeys.branding.all, { staleTime: 30 * 60_000 });
  return client;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <ErrorBoundary>
      <SessionProvider>
        <QueryClientProvider client={queryClient}>
          <UiToastProvider>{children}</UiToastProvider>
        </QueryClientProvider>
      </SessionProvider>
    </ErrorBoundary>
  );
}
