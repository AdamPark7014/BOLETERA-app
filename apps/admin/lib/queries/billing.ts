'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';

export type FiscalProfile = {
  id: string;
  rfc: string;
  legalName: string;
  regimenFiscal: string;
  codigoPostal: string;
  serie: string;
  pacMode: string;
};

export type CfdiInvoice = {
  id: string;
  uuid: string | null;
  serie: string;
  folio: number;
  status: string;
  receptorRfc: string;
  total: string | number;
  stampedAt: string | null;
  orderId: string | null;
};

export function useFiscalProfile(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.billing.fiscalProfile(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<FiscalProfile | null>(`/billing/${organizationId}/fiscal-profile`, { signal }),
    enabled: Boolean(organizationId),
  });
}

export function useCfdiInvoices(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.billing.invoices(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<CfdiInvoice[]>(`/billing/${organizationId}/cfdi`, { signal }),
    enabled: Boolean(organizationId),
  });
}

export function useUpsertFiscalProfile(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<FiscalProfile, 'id' | 'regimenFiscal' | 'serie' | 'pacMode'> & {
      regimenFiscal?: string;
      serie?: string;
      pacMode?: string;
    }) =>
      http<FiscalProfile>(`/billing/${organizationId}/fiscal-profile`, {
        method: 'POST',
        body,
      }),
    onSuccess: (profile) =>
      client.setQueryData(queryKeys.billing.fiscalProfile(organizationId), profile),
  });
}

export function useStampCfdi(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      orderId: string;
      receptorRfc: string;
      receptorNombre: string;
      receptorUsoCfdi?: string;
    }) =>
      http(`/billing/${organizationId}/cfdi/stamp`, { method: 'POST', body }),
    onSettled: () =>
      client.invalidateQueries({ queryKey: queryKeys.billing.invoices(organizationId) }),
  });
}
