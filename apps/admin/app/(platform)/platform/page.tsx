'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  DataTable,
  KpiCard,
  PageHeader,
  Section,
  formatNumber,
  type BadgeTone,
  type DataTableColumn,
} from '@boletera/ui';
import { getSaasCapabilities, type SaasCapabilities } from '@/lib/platform-api';
import { useOrgId } from '@/lib/use-org';
import styles from './platform.module.scss';

type RoadmapRow = SaasCapabilities['roadmap'][number];

function formatModuleKey(key: string) {
  return key.replace(/([A-Z])/g, ' $1').trim();
}

function roadmapStatusTone(status: string): BadgeTone {
  const s = status.toLowerCase();
  if (s.includes('done') || s.includes('live') || s.includes('shipped') || s.includes('activ')) {
    return 'success';
  }
  if (s.includes('progress') || s.includes('prog') || s.includes('beta')) return 'info';
  if (s.includes('plan') || s.includes('pend') || s.includes('backlog')) return 'warning';
  return 'neutral';
}

function roadmapPriorityTone(priority: string): BadgeTone {
  const p = priority.toLowerCase();
  if (p.includes('high') || p.includes('alta') || p === 'p0' || p === 'p1') return 'danger';
  if (p.includes('med') || p === 'p2') return 'warning';
  return 'neutral';
}

const ROADMAP_COLUMNS: DataTableColumn<RoadmapRow>[] = [
  { key: 'label', header: 'Feature', sortValue: (row) => row.label },
  {
    key: 'status',
    header: 'Estado',
    render: (row) => (
      <Badge tone={roadmapStatusTone(row.status)} variant="soft" size="sm">
        {row.status}
      </Badge>
    ),
  },
  {
    key: 'priority',
    header: 'Prioridad',
    render: (row) => (
      <Badge tone={roadmapPriorityTone(row.priority)} variant="outline" size="sm">
        {row.priority}
      </Badge>
    ),
  },
];

export default function PlatformCapabilitiesPage() {
  const orgId = useOrgId();
  const [data, setData] = useState<SaasCapabilities | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    if (!token || !orgId) return;
    getSaasCapabilities(token, orgId).then(setData).catch(() => {});
  }, [orgId]);

  const modules = data ? Object.entries(data.modules) : [];
  const active = modules.filter(([, v]) => v).length;
  const roadmap = useMemo(() => data?.roadmap ?? [], [data?.roadmap]);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Plataforma"
        title="Plataforma Boletera"
        description={
          data
            ? `Matriz de capacidades vs Palco4 · Pasco · NewTicket — ${data.organization.name}`
            : 'Matriz de capacidades vs Palco4 · Pasco · NewTicket'
        }
      />

      {data ? (
        <Section columns={3} gap="md" aria-label="Indicadores de la organización">
          <KpiCard
            label="Módulos activos"
            value={`${formatNumber(active)}/${formatNumber(modules.length)}`}
            tone="accent"
          />
          <KpiCard
            label="Waitlist pendiente"
            value={formatNumber(data.metrics.waitlistPending)}
            tone={data.metrics.waitlistPending > 0 ? 'warning' : 'neutral'}
          />
          <KpiCard label="API keys" value={formatNumber(data.metrics.apiKeys)} />
        </Section>
      ) : null}

      <Section title="Módulos habilitados">
        <div className={styles.chipRow}>
          {modules.map(([key, on]) => (
            <Badge
              key={key}
              tone={on ? 'success' : 'neutral'}
              variant={on ? 'soft' : 'outline'}
              size="sm"
              dot={on}
            >
              {formatModuleKey(key)}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title="Roadmap (supera competencia)">
        <DataTable
          columns={ROADMAP_COLUMNS}
          data={roadmap}
          rowKey={(row) => row.id}
          label="Roadmap de capacidades"
          empty="Sin elementos en el roadmap"
        />
      </Section>
    </div>
  );
}
