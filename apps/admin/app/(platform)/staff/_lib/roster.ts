import type { TeamMember } from '@/lib/queries/organization';
import type { DonutSlice } from '@boletera/ui';
import { roleLabel, TEAM_ROLES, type TeamRole } from './roles';

export type StaffTab = 'roster' | 'roles' | 'assignments' | 'activity';

export type StaffKpis = {
  total: number;
  active: number;
  inactive: number;
  neverLoggedIn: number;
  rolesInUse: number;
  byRole: readonly { role: TeamRole; label: string; count: number }[];
};

export function computeStaffKpis(team: readonly TeamMember[]): StaffKpis {
  const active = team.filter((member) => member.active).length;
  const neverLoggedIn = team.filter((member) => member.active && !member.lastLogin).length;
  const byRole = TEAM_ROLES.map((role) => ({
    role: role.value,
    label: role.label,
    count: team.filter((member) => member.role === role.value).length,
  }));

  return {
    total: team.length,
    active,
    inactive: team.length - active,
    neverLoggedIn,
    rolesInUse: byRole.filter((row) => row.count > 0).length,
    byRole,
  };
}

export function roleSlices(team: readonly TeamMember[]): DonutSlice[] {
  return TEAM_ROLES.map((role) => ({
    id: role.value,
    label: role.label,
    value: team.filter((member) => member.role === role.value).length,
  })).filter((slice) => slice.value > 0);
}

export type MemberStatusFilter = 'all' | 'active' | 'inactive' | 'pending';

export function matchesMember(
  member: TeamMember,
  options: { query: string; status: MemberStatusFilter; role: string },
): boolean {
  const term = options.query.trim().toLowerCase();
  const matchesQuery =
    !term ||
    member.email.toLowerCase().includes(term) ||
    member.firstName.toLowerCase().includes(term) ||
    member.lastName.toLowerCase().includes(term) ||
    roleLabel(member.role).toLowerCase().includes(term);

  const matchesStatus =
    options.status === 'all' ||
    (options.status === 'active'
      ? member.active
      : options.status === 'inactive'
        ? !member.active
        : member.active && !member.lastLogin);

  const matchesRole = options.role === 'all' || member.role === options.role;

  return matchesQuery && matchesStatus && matchesRole;
}

export function filterTeam(
  team: readonly TeamMember[],
  options: { query: string; status: MemberStatusFilter; role: string },
): TeamMember[] {
  return team.filter((member) => matchesMember(member, options));
}

export function sortByRecentLogin(team: readonly TeamMember[]): TeamMember[] {
  return [...team].sort((a, b) => {
    const aTime = a.lastLogin ? new Date(a.lastLogin).getTime() : 0;
    const bTime = b.lastLogin ? new Date(b.lastLogin).getTime() : 0;
    return bTime - aTime;
  });
}
