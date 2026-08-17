'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';

export type OrderRow = {
  id: string;
  publicId: string;
  status: string;
  channel: string;
  totalAmount: string;
  currency: string;
  buyerName: string;
  buyerEmail: string;
  createdAt: string;
  event: { title: string };
  payment: { gateway: string; status: string } | null;
};

export type OrderDetail = OrderRow & Record<string, unknown>;

export function useOrders(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: queryKeys.orders.list(filters),
    queryFn: ({ signal }) => http<OrderRow[]>('/admin/orders', { signal }),
  });
}

export function useOrder(orderId: string) {
  return useQuery({
    queryKey: queryKeys.orders.detail(orderId),
    queryFn: ({ signal }) => http<OrderDetail>(`/admin/orders/${orderId}`, { signal }),
    enabled: Boolean(orderId),
  });
}

function useOrderAction(
  action: (orderId: string) => Promise<unknown>,
  optimisticStatus?: string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: action,
    onMutate: async (orderId) => {
      await client.cancelQueries({ queryKey: queryKeys.orders.all });
      const snapshots = client.getQueriesData<OrderRow[]>({
        queryKey: queryKeys.orders.all,
      });
      if (optimisticStatus) {
        client.setQueriesData<OrderRow[]>(
          { queryKey: queryKeys.orders.all },
          (orders) =>
            orders?.map((order) =>
              order.id === orderId ? { ...order, status: optimisticStatus } : order,
            ),
        );
      }
      return { snapshots };
    },
    onError: (_error, _orderId, context) =>
      context?.snapshots.forEach(([key, data]) => client.setQueryData(key, data)),
    onSettled: (_data, _error, orderId) => {
      void client.invalidateQueries({ queryKey: queryKeys.orders.all });
      void client.invalidateQueries({ queryKey: queryKeys.orders.detail(orderId) });
      void client.invalidateQueries({ queryKey: queryKeys.overview.all });
    },
  });
}

export function useCancelOrder() {
  return useOrderAction(
    (orderId) => http(`/admin/orders/${orderId}/cancel`, { method: 'POST' }),
    'CANCELLED',
  );
}

export function useResendOrderEmail() {
  return useOrderAction((orderId) =>
    http(`/admin/orders/${orderId}/resend-email`, { method: 'POST' }),
  );
}
