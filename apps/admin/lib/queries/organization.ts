'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';
import type { SaasCapabilities } from '../platform-api';

export type TeamMember = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  active: boolean;
  lastLogin: string | null;
};

export type InviteTeamMemberInput = Omit<TeamMember, 'id' | 'active' | 'lastLogin'> & {
  password: string;
};

export function useOrganization(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.organization.detail(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<Record<string, unknown>>(`/organization/${organizationId}`, { signal }),
    enabled: Boolean(organizationId),
  });
}

export function useSaasCapabilities(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.organization.capabilities(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<SaasCapabilities>(
        `/organization/capabilities?organizationId=${organizationId}`,
        { signal },
      ),
    enabled: Boolean(organizationId),
  });
}

export function useTeam(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.organization.team(organizationId ?? ''),
    queryFn: ({ signal }) =>
      http<TeamMember[]>(`/organization/${organizationId}/team`, { signal }),
    enabled: Boolean(organizationId),
  });
}

export function useInviteTeamMember(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: InviteTeamMemberInput) =>
      http<TeamMember>(`/organization/${organizationId}/team`, {
        method: 'POST',
        body,
      }),
    onSuccess: (member) =>
      client.setQueryData<TeamMember[]>(
        queryKeys.organization.team(organizationId),
        (team = []) => [...team, member],
      ),
  });
}
