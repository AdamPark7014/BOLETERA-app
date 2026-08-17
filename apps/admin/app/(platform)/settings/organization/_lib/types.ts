import type { TeamRole } from './roles';

export type OrgTab = 'profile' | 'team' | 'roles' | 'audit';

export const ORG_TABS: readonly OrgTab[] = ['profile', 'team', 'roles', 'audit'];

export function isOrgTab(value: string): value is OrgTab {
  return (ORG_TABS as readonly string[]).includes(value);
}

export type OrganizationProfile = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  verified: boolean;
  commissionRate: number | string;
  allowResale: boolean;
  feesInclusive?: boolean;
  _count?: {
    events: number;
    venues: number;
    users: number;
    orders: number;
  };
};

export type ProfileForm = {
  name: string;
  description: string;
  website: string;
  email: string;
  phone: string;
  allowResale: boolean;
};

export type InviteForm = {
  email: string;
  firstName: string;
  lastName: string;
  role: TeamRole;
  password: string;
};

export const INITIAL_INVITE: InviteForm = {
  email: '',
  firstName: '',
  lastName: '',
  role: 'TAQUILLA',
  password: '',
};

/** Narrowing seguro del payload de `useOrganization` (viene tipado como Record). */
export function isOrganizationProfile(value: unknown): value is OrganizationProfile {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    typeof row.slug === 'string'
  );
}

export function profileFromOrg(org: OrganizationProfile): ProfileForm {
  return {
    name: org.name,
    description: org.description ?? '',
    website: org.website ?? '',
    email: org.email ?? '',
    phone: org.phone ?? '',
    allowResale: Boolean(org.allowResale),
  };
}
