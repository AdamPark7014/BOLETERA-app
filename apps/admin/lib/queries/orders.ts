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

/**
 * Sobre de GET /admin/orders. El endpoint NO devuelve un array.
 *
 * Importa el detalle: el array vive en `.data`, y react-query envuelve a su vez
 * el resultado en otro `.data`. La colisión de nombres es justo la trampa que
 * hacía escribir `query.data ?? []` creyendo tener la lista — se obtenía el
 * sobre, el `??` no saltaba porque el sobre existe, y el CRM reventaba con
 * «orders is not iterable» al recorrerlo.
 */
export type OrdersEnvelope = {
  data: OrderRow[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
  filters?: Record<string, unknown>;
  warnings?: string[];
};

/**
 * Lista de órdenes.
 *
 * Los filtros SE ENVÍAN al backend. Antes solo entraban en la clave de caché:
 * cada juego de filtros abría una entrada distinta que guardaba exactamente la
 * misma respuesta sin filtrar, así que `useOrders({ limit: 500 })` devolvía la
 * página por defecto mientras aparentaba estar acotado.
 *
 * Devuelve el array ya desenvuelto, que es lo que espera todo el que la usa.
 * Para paginar, usa `useOrdersPage`.
 */
export function useOrders(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: queryKeys.orders.list(filters),
    queryFn: ({ signal }) => http<OrdersEnvelope>(ordersPath(filters), { signal }),
    select: (envelope) => envelope.data ?? [],
  });
}

/** Igual que `useOrders`, pero conserva el sobre (cursor, hasMore, avisos). */
export function useOrdersPage(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: queryKeys.orders.list(filters),
    queryFn: ({ signal }) => http<OrdersEnvelope>(ordersPath(filters), { signal }),
  });
}

/** Serializa los filtros a query string, omitiendo vacíos y nulos. */
function ordersPath(filters: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `/admin/orders?${qs}` : '/admin/orders';
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
