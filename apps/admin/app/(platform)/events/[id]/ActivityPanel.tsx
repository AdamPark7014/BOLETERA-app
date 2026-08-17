'use client';

import {
  ActivityFeed,
  Card,
  CardHeader,
  EmptyState,
} from '@boletera/ui';
import type { ActivityItem } from '@boletera/ui';
import type { AuditEntry } from '@/lib/queries/audit';
import { formatRelative } from './format';
import styles from './event-hub.module.scss';

type Props = {
  eventId: string;
  entries: AuditEntry[] | undefined;
  loading: boolean;
  error: string | null;
  canReadAudit: boolean;
};

function toActivityItems(
  entries: readonly AuditEntry[],
  eventId: string,
): ActivityItem[] {
  return entries
    .filter(
      (entry) =>
        entry.entityId === eventId ||
        entry.entityType.toLowerCase().includes('event') ||
        String(entry.metadata?.eventId ?? '') === eventId,
    )
    .slice(0, 40)
    .map((entry) => ({
      id: entry.id,
      actor: 'Sistema',
      action: entry.action,
      target: `${entry.entityType} · ${entry.entityId}`,
      timestamp: entry.createdAt,
      detail: formatRelative(entry.createdAt) || undefined,
    }));
}

export function ActivityPanel({
  eventId,
  entries,
  loading,
  error,
  canReadAudit,
}: Props) {
  if (!canReadAudit) {
    return (
      <div
        className={styles.tabPanel}
        role="tabpanel"
        id="hub-panel-activity"
        aria-labelledby="hub-tab-activity"
      >
        <EmptyState
          title="Sin permiso de auditoría"
          description="Necesitas el permiso audit:read para ver la actividad del evento."
          illustration="error"
          tone="neutral"
        />
      </div>
    );
  }

  const items = toActivityItems(entries ?? [], eventId);

  return (
    <div
      className={styles.tabPanel}
      role="tabpanel"
      id="hub-panel-activity"
      aria-labelledby="hub-tab-activity"
    >
      <Card variant="outline" padding="md">
        <CardHeader
          title="Actividad y auditoría"
          description="Entradas del log organizacional relacionadas con este evento"
        />
        {error ? (
          <EmptyState
            title="No se pudo cargar la auditoría"
            description={error}
            illustration="error"
            tone="danger"
            size="sm"
          />
        ) : loading && items.length === 0 ? (
          <EmptyState
            title="Cargando actividad…"
            description="Consultando el log de auditoría."
            illustration="inbox"
            size="sm"
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="Sin actividad registrada"
            description="No hay entradas de auditoría asociadas a este evento en el log reciente."
            illustration="inbox"
            size="sm"
          />
        ) : (
          <ActivityFeed items={items} label="Auditoría del evento" />
        )}
      </Card>
    </div>
  );
}
