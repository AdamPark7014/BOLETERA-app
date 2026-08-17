'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';

/** Periodo de facturación del plan. */
export type MembershipBillingPeriod = 'MONTHLY' | 'ANNUAL' | 'SEASON' | string;

/** Plan / tier de membresía. */
export type MembershipPlan = {
  id: string;
  name: string;
  slug: string;
  tier: string;
  description?: string | null;
  price: string | number;
  billingPeriod: MembershipBillingPeriod;
  active: boolean;
  memberCount: number;
  maxMembers?: number | null;
  benefitCount?: number;
  renewalRate?: number | null;
  createdAt?: string;
};

export type MembershipMetrics = {
  activeMembers: number;
  benefitsRedeemed: number;
  renewalRate: number | null;
  retention12m: number | null;
  revenue: string | number | null;
  mrr?: string | number | null;
};

export type MembershipBenefit = {
  id: string;
  name: string;
  type: string;
  planId?: string | null;
  planName?: string | null;
  redemptionLimit: number | null;
  redemptionsUsed: number;
  active: boolean;
};

export type MembershipBenefitUsage = {
  benefitId: string;
  benefitName: string;
  redemptions: number;
  uniqueMembers: number;
};

export type MembershipRenewalStatus =
  | 'UPCOMING'
  | 'DUE'
  | 'OVERDUE'
  | 'RENEWED'
  | 'LAPSED'
  | string;

export type MembershipRenewal = {
  id: string;
  membershipId: string;
  memberName: string;
  memberEmail?: string | null;
  planName: string;
  expiresAt: string;
  status: MembershipRenewalStatus;
  amount?: string | number | null;
};

export type MembershipRetentionPoint = {
  label: string;
  /** Tasa 0–1 o porcentaje 0–100; la UI normaliza. */
  value: number;
};

export type MembershipActivity = {
  id: string;
  action: string;
  actor?: string | null;
  target?: string | null;
  detail?: string | null;
  createdAt: string;
};

export type CreateMembershipPlanInput = {
  name: string;
  slug: string;
  tier: string;
  price: number;
  billingPeriod: MembershipBillingPeriod;
  description?: string;
  maxMembers?: number;
};

const STALE_TIME = 30_000;

function orgBase(organizationId: string): string {
  return `/memberships/organization/${organizationId}`;
}

export function useMembershipPlans(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.memberships.plans(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<MembershipPlan[]>(`${orgBase(organizationId!)}/plans`, { signal }),
    enabled: Boolean(organizationId),
    staleTime: STALE_TIME,
    retry: false,
  });
}

export function useMembershipMetrics(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.memberships.metrics(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<MembershipMetrics>(`${orgBase(organizationId!)}/metrics`, { signal }),
    enabled: Boolean(organizationId),
    staleTime: STALE_TIME,
    retry: false,
  });
}

export function useMembershipBenefits(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.memberships.benefits(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<MembershipBenefit[]>(`${orgBase(organizationId!)}/benefits`, { signal }),
    enabled: Boolean(organizationId),
    staleTime: STALE_TIME,
    retry: false,
  });
}

export function useMembershipBenefitUsage(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.memberships.benefitUsage(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<MembershipBenefitUsage[]>(`${orgBase(organizationId!)}/benefits/usage`, {
        signal,
      }),
    enabled: Boolean(organizationId),
    staleTime: STALE_TIME,
    retry: false,
  });
}

export function useMembershipRenewals(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.memberships.renewals(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<MembershipRenewal[]>(`${orgBase(organizationId!)}/renewals`, { signal }),
    enabled: Boolean(organizationId),
    staleTime: STALE_TIME,
    retry: false,
  });
}

export function useMembershipRetention(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.memberships.retention(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<MembershipRetentionPoint[]>(`${orgBase(organizationId!)}/retention`, {
        signal,
      }),
    enabled: Boolean(organizationId),
    staleTime: STALE_TIME,
    retry: false,
  });
}

export function useMembershipActivity(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.memberships.activity(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<MembershipActivity[]>(`${orgBase(organizationId!)}/activity`, { signal }),
    enabled: Boolean(organizationId),
    staleTime: STALE_TIME,
    retry: false,
  });
}

export function useCreateMembershipPlan(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMembershipPlanInput) =>
      http<MembershipPlan>(`${orgBase(organizationId)}/plans`, {
        method: 'POST',
        body,
      }),
    onSuccess: (plan) =>
      client.setQueryData<MembershipPlan[]>(
        queryKeys.memberships.plans(organizationId),
        (current = []) => [...current, plan],
      ),
    onSettled: () => {
      void client.invalidateQueries({
        queryKey: queryKeys.memberships.plans(organizationId),
      });
      void client.invalidateQueries({
        queryKey: queryKeys.memberships.metrics(organizationId),
      });
    },
  });
}

export function useRenewMembership(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) =>
      http(`/memberships/${membershipId}/renew`, { method: 'POST' }),
    onSettled: () => {
      void client.invalidateQueries({
        queryKey: queryKeys.memberships.renewals(organizationId),
      });
      void client.invalidateQueries({
        queryKey: queryKeys.memberships.metrics(organizationId),
      });
      void client.invalidateQueries({
        queryKey: queryKeys.memberships.activity(organizationId),
      });
    },
  });
}
