import type { AuditEntry } from '@/lib/queries/audit';
import type { TeamMember } from '@/lib/queries/organization';
import type { ActivityItem } from '@boletera/ui';
import { memberDisplayName } from './format';
import { roleLabel } from './roles';

const VERBS: Readonly<Record<string, string>> = {
  ORG_UPDATED: 'actualizó la organización',
  TEAM_MEMBER_INVITED: 'invitó a',
  TEAM_MEMBER_UPDATED: 'actualizó a',
  TEAM_MEMBER_REMOVED: 'retiró a',
  USER_LOGIN: 'inició sesión',
  API_KEY_CREATED: 'creó una API key',
  API_KEY_REVOKED: 'revocó una API key',
};

export function auditVerb(action: string): string {
  return VERBS[action] ?? action.toLowerCase().replaceAll('_', ' ');
}

export function isTeamAudit(entry: AuditEntry): boolean {
  return (
    entry.entityType === 'User' ||
    entry.entityType === 'TeamMember' ||
    entry.action.startsWith('TEAM_') ||
    entry.action === 'USER_LOGIN' ||
    entry.action === 'ORG_UPDATED'
  );
}

export function auditToActivity(entries: readonly AuditEntry[], limit = 24): ActivityItem[] {
  return entries
    .filter(isTeamAudit)
    .slice(0, limit)
    .map((entry) => {
      const meta = entry.metadata ?? {};
      const email = typeof meta.email === 'string' ? meta.email : undefined;
      const name = typeof meta.name === 'string' ? meta.name : undefined;
      return {
        id: entry.id,
        actor: 'Administración',
        action: auditVerb(entry.action),
        target: email ?? name ?? entry.entityType,
        timestamp: entry.createdAt,
        detail: entry.entityId.slice(0, 8),
      };
    });
}

export function loginToActivity(team: readonly TeamMember[], limit = 12): ActivityItem[] {
  return [...team]
    .filter((member) => Boolean(member.lastLogin))
    .sort((a, b) => {
      const aTime = a.lastLogin ? new Date(a.lastLogin).getTime() : 0;
      const bTime = b.lastLogin ? new Date(b.lastLogin).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, limit)
    .map((member) => ({
      id: `login-${member.id}`,
      actor: memberDisplayName(member.firstName, member.lastName),
      action: 'accedió al panel',
      target: roleLabel(member.role),
      timestamp: member.lastLogin as string,
      detail: member.email,
    }));
}

export function mergeActivity(
  audit: readonly ActivityItem[],
  logins: readonly ActivityItem[],
  limit = 20,
): ActivityItem[] {
  return [...audit, ...logins]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}
