import type { AuditEntry } from '@/lib/queries/audit';
import type { ActivityItem } from '@boletera/ui';

const VERBS: Readonly<Record<string, string>> = {
  ORG_UPDATED: 'actualizó la organización',
  TEAM_MEMBER_INVITED: 'invitó a',
  TEAM_MEMBER_UPDATED: 'actualizó a',
  API_KEY_CREATED: 'creó una API key',
  API_KEY_REVOKED: 'revocó una API key',
  SEASON_PASS_CREATED: 'creó un abono',
};

export function auditVerb(action: string): string {
  return VERBS[action] ?? action.toLowerCase().replaceAll('_', ' ');
}

export function toActivityItems(entries: readonly AuditEntry[], limit = 20): ActivityItem[] {
  return entries.slice(0, limit).map((entry) => {
    const meta = entry.metadata ?? {};
    const email = typeof meta.email === 'string' ? meta.email : undefined;
    const name = typeof meta.name === 'string' ? meta.name : undefined;
    return {
      id: entry.id,
      actor: 'Equipo',
      action: auditVerb(entry.action),
      target: email ?? name ?? entry.entityType,
      timestamp: entry.createdAt,
      detail: entry.entityId.slice(0, 8),
    };
  });
}
