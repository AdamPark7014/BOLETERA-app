'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';

export type SponsorStatus = 'ACTIVE' | 'PROSPECT' | 'CHURNED' | 'PAUSED' | string;

export type Sponsor = {
  id: string;
  name: string;
  category: string;
  status: SponsorStatus;
  contactEmail?: string | null;
  website?: string | null;
  activeContractCount?: number;
  createdAt?: string;
};

export type SponsorshipAssetType =
  | 'VENUE'
  | 'DIGITAL'
  | 'HOSPITALITY'
  | 'CONTENT'
  | 'ON_SITE'
  | string;

export type SponsorshipAsset = {
  id: string;
  name: string;
  type: SponsorshipAssetType;
  venueLabel?: string | null;
  inventory: number;
  allocated: number;
  exclusiveCategory?: string | null;
  active?: boolean;
};

/** Paquete comercial / activación contractual. */
export type SponsorshipPackageStatus =
  | 'PROSPECT'
  | 'PROPOSAL'
  | 'NEGOTIATION'
  | 'ACTIVE'
  | 'FULFILLED'
  | 'CHURNED'
  | string;

export type SponsorshipPackage = {
  id: string;
  name: string;
  sponsorId?: string | null;
  sponsorName?: string | null;
  status: SponsorshipPackageStatus;
  /** Valor del contrato en MXN (unidades). */
  value: string | number;
  startsAt?: string | null;
  endsAt?: string | null;
  deliverablesTotal: number;
  deliverablesDone: number;
  impressions?: number | null;
  /** ROI estimado o realizado como ratio (p. ej. 1.5 = 150%). */
  estimatedRoi?: number | null;
  actualRoi?: number | null;
  category?: string | null;
};

export type SponsorshipComplianceSummary = {
  onTrackRate: number | null;
  openIssues: number;
  overdueDeliverables: number;
  completedDeliverables: number;
};

export type SponsorshipComplianceIssue = {
  id: string;
  title: string;
  severity: 'info' | 'warning' | 'danger' | string;
  packageId?: string | null;
  packageName?: string | null;
  dueAt?: string | null;
};

export type SponsorshipActivity = {
  id: string;
  action: string;
  actor?: string | null;
  target?: string | null;
  detail?: string | null;
  createdAt: string;
};

export type CreateSponsorshipPackageInput = {
  name: string;
  sponsorName: string;
  category?: string;
  value: number;
  deliverablesTotal: number;
  startsAt?: string;
  endsAt?: string;
};

const STALE_TIME = 30_000;

function orgBase(organizationId: string): string {
  return `/sponsorships/organization/${organizationId}`;
}

export function useSponsors(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.sponsorships.sponsors(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<Sponsor[]>(`${orgBase(organizationId!)}/sponsors`, { signal }),
    enabled: Boolean(organizationId),
    staleTime: STALE_TIME,
    retry: false,
  });
}

export function useSponsorshipAssets(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.sponsorships.assets(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<SponsorshipAsset[]>(`${orgBase(organizationId!)}/assets`, { signal }),
    enabled: Boolean(organizationId),
    staleTime: STALE_TIME,
    retry: false,
  });
}

export function useSponsorshipPackages(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.sponsorships.packages(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<SponsorshipPackage[]>(`${orgBase(organizationId!)}/packages`, { signal }),
    enabled: Boolean(organizationId),
    staleTime: STALE_TIME,
    retry: false,
  });
}

/** Alias de paquetes vía ruta de activaciones (compatibilidad con contrato legacy). */
export function useSponsorshipActivations(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.sponsorships.activations(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<SponsorshipPackage[]>(`${orgBase(organizationId!)}/activations`, {
        signal,
      }),
    enabled: Boolean(organizationId),
    staleTime: STALE_TIME,
    retry: false,
  });
}

export function useSponsorshipCompliance(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.sponsorships.compliance(organizationId ?? ''),
    queryFn: async ({ signal }) => {
      const base = orgBase(organizationId!);
      const [summary, issues] = await Promise.all([
        http<SponsorshipComplianceSummary>(`${base}/compliance/summary`, {
          signal,
        }),
        http<SponsorshipComplianceIssue[]>(`${base}/compliance/issues`, {
          signal,
        }).catch(() => [] as SponsorshipComplianceIssue[]),
      ]);
      return { summary, issues };
    },
    enabled: Boolean(organizationId),
    staleTime: STALE_TIME,
    retry: false,
  });
}

export function useSponsorshipActivity(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.sponsorships.activity(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<SponsorshipActivity[]>(`${orgBase(organizationId!)}/activity`, {
        signal,
      }),
    enabled: Boolean(organizationId),
    staleTime: STALE_TIME,
    retry: false,
  });
}

export function useCreateSponsorshipPackage(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSponsorshipPackageInput) =>
      http<SponsorshipPackage>(`${orgBase(organizationId)}/packages`, {
        method: 'POST',
        body,
      }),
    onSuccess: (pkg) =>
      client.setQueryData<SponsorshipPackage[]>(
        queryKeys.sponsorships.packages(organizationId),
        (current = []) => [...current, pkg],
      ),
    onSettled: () => {
      void client.invalidateQueries({
        queryKey: queryKeys.sponsorships.packages(organizationId),
      });
      void client.invalidateQueries({
        queryKey: queryKeys.sponsorships.sponsors(organizationId),
      });
      void client.invalidateQueries({
        queryKey: queryKeys.sponsorships.activity(organizationId),
      });
    },
  });
}
