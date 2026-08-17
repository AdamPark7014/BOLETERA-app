'use client';

import { useMemo } from 'react';
import {
  useAiCustomerSegmentation,
  useAiRecommendations,
} from './ai';
import { useAuditLog } from './audit';
import { usePromoterAnalytics } from './analytics';
import {
  useExecutiveMetrics,
  useMetricsTimeseries,
  useOrdersMetrics,
  useWaitlistMetrics,
} from './metrics';
import { useOrders } from './orders';
import { useApiKeys } from './partners';
import { useWaitlist } from './waitlist';

export type CrmWorkspaceParams = {
  organizationId: string | null;
  from: string;
  to: string;
  /** Habilita lecturas que requieren organizationId. */
  enabled?: boolean;
};

/**
 * Fuentes del CRM enterprise. No hay GET /crm/*: agregamos pedidos,
 * métricas, waitlist, partners, audit y señales AI opcionales.
 *
 * Límites documentados en la UI:
 * - useOrders no envía filtros/paginación al backend en este cliente.
 * - RFM/LTV/churn locales son heurísticos sobre la muestra recibida.
 * - AI segmentation/recommendations pueden ser insuficientes o fallar.
 */
export function useCrmWorkspace(params: CrmWorkspaceParams) {
  const enabled = params.enabled !== false;
  const orgId = params.organizationId;
  const range = useMemo(
    () => ({
      organizationId: orgId ?? undefined,
      from: params.from,
      to: params.to,
    }),
    [orgId, params.from, params.to],
  );

  const orders = useOrders({ scope: 'crm', limit: 500 });
  const ordersMetrics = useOrdersMetrics(range);
  const executive = useExecutiveMetrics(range);
  const waitlistMetrics = useWaitlistMetrics(range);
  const timeseries = useMetricsTimeseries({
    ...range,
    granularity: 'day',
    metric: 'orders',
  });
  const waitlist = useWaitlist(enabled ? orgId : null);
  const apiKeys = useApiKeys(enabled ? orgId : null);
  const audit = useAuditLog(enabled ? orgId : null, 60);
  const analytics = usePromoterAnalytics(enabled ? orgId : null, 'MONTH');
  const aiSegmentation = useAiCustomerSegmentation({
    ...range,
    limit: 200,
  });
  const aiRecommendations = useAiRecommendations({
    ...range,
    limit: 12,
  });

  return {
    orders,
    ordersMetrics,
    executive,
    waitlistMetrics,
    timeseries,
    waitlist,
    apiKeys,
    audit,
    analytics,
    aiSegmentation,
    aiRecommendations,
    refetchAll: () => {
      void orders.refetch();
      void ordersMetrics.refetch();
      void executive.refetch();
      void waitlistMetrics.refetch();
      void timeseries.refetch();
      void waitlist.refetch();
      void apiKeys.refetch();
      void audit.refetch();
      void analytics.refetch();
      void aiSegmentation.refetch();
      void aiRecommendations.refetch();
    },
  };
}

export type CrmWorkspace = ReturnType<typeof useCrmWorkspace>;
