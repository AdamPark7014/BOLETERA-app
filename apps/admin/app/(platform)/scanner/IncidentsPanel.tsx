'use client';

import { Badge, Card, CardHeader, EmptyState, Timeline } from '@boletera/ui';
import type { TimelineItem, TimelineTone } from '@boletera/ui';
import type { Incident } from './types';
import { formatClock, formatRelative } from './format';
import styles from './scanner.module.scss';

type Props = {
  incidents: readonly Incident[];
  loading: boolean;
};

function toneOf(incident: Incident): TimelineTone {
  if (incident.tone === 'critical') return 'danger';
  if (incident.tone === 'warning') return 'warning';
  return 'info';
}

export function IncidentsPanel({ incidents, loading }: Props) {
  const items: TimelineItem[] = incidents.map((incident) => ({
    id: incident.id,
    title: incident.title,
    description: `${incident.detail} · ${formatClock(incident.at)} (${formatRelative(incident.at)})`,
    timestamp: incident.at,
    tone: toneOf(incident),
    children:
      incident.origin === 'station' ? (
        <Badge tone="warning" variant="outline" size="sm">
          Estación
        </Badge>
      ) : (
        <Badge tone="info" variant="outline" size="sm">
          Plataforma
        </Badge>
      ),
  }));

  return (
    <Card className={styles.panel} padding="md">
      <CardHeader
        title="Incidentes"
        description="Rechazos locales y alertas de acceso"
        actions={
          <Badge tone={incidents.length ? 'danger' : 'neutral'} variant="soft" size="sm">
            {incidents.length}
          </Badge>
        }
      />
      {loading && incidents.length === 0 ? (
        <EmptyState
          title="Cargando incidentes"
          description="Consultando alertas de plataforma…"
          illustration="inbox"
          size="sm"
        />
      ) : incidents.length === 0 ? (
        <EmptyState
          title="Sin incidentes"
          description="Los rechazos de esta estación y las alertas de acceso aparecerán aquí."
          illustration="success"
          tone="success"
          size="sm"
        />
      ) : (
        <Timeline items={items} label="Incidentes de acceso" />
      )}
    </Card>
  );
}
