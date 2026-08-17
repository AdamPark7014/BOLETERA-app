'use client';

import { useMemo, useState } from 'react';
import {
  ActivityFeed,
  BarChart,
  Button,
  Card,
  CardHeader,
  Drawer,
  EmptyState,
  KpiCard,
  PageHeader,
  SearchInput,
  SkeletonCard,
  StatusDot,
} from '@boletera/ui';
import { useSession } from '@/lib/use-session';
import styles from './OperatingModulePage.module.scss';

export type ModuleKpi = {
  label: string;
  value?: string;
  unit?: string;
  hint: string;
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
};

export type ModuleProjection = {
  label: string;
  value: number;
};

export type ModuleRecord = {
  id: string;
  name: string;
  meta: string;
  status: string;
  statusTone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  detail: string;
};

export type OperatingModuleConfig = {
  eyebrow: string;
  title: string;
  description: string;
  permission: string;
  actionLabel: string;
  searchLabel: string;
  listTitle: string;
  listDescription: string;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction: string;
  chartTitle: string;
  chartDescription: string;
  chartLabel: string;
  projectionCaption: string;
  projection: readonly ModuleProjection[];
  kpis: readonly ModuleKpi[];
  records?: readonly ModuleRecord[];
  recommendations: readonly {
    title: string;
    description: string;
    tone: 'info' | 'success' | 'warning' | 'danger';
    action: string;
  }[];
  endpoints: readonly string[];
};

export function OperatingModulePage({ config }: { config: OperatingModuleConfig }) {
  const { status, can } = useSession();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ModuleRecord | null>(null);
  const records = config.records ?? [];
  const visibleRecords = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es-MX');
    if (!normalized) return records;
    return records.filter((record) =>
      `${record.name} ${record.meta} ${record.status}`.toLocaleLowerCase('es-MX').includes(normalized),
    );
  }, [query, records]);
  const permitted = can(config.permission);

  if (status === 'loading') {
    return (
      <main className={styles.page} aria-busy="true" aria-label={`Cargando ${config.title}`}>
        <SkeletonCard lines={3} />
        <div className={styles.kpis}>
          {config.kpis.map((kpi) => <SkeletonCard key={kpi.label} lines={2} />)}
        </div>
        <SkeletonCard lines={6} />
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow={config.eyebrow}
        title={config.title}
        description={config.description}
        breadcrumbs={[{ label: 'TicketOS', href: '/dashboard' }, { label: config.title }]}
        actions={
          <Button disabled={!permitted} title={!permitted ? 'No tienes permiso para realizar esta acción' : undefined}>
            {config.actionLabel}
          </Button>
        }
      />

      <section className={styles.kpis} aria-label="Indicadores principales">
        {config.kpis.map((kpi) => (
          <KpiCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value ?? '—'}
            unit={kpi.unit}
            hint={kpi.value ? kpi.hint : `Sin datos · ${kpi.hint}`}
            tone={kpi.tone}
          />
        ))}
      </section>

      <div className={styles.primaryGrid}>
        <Card className={styles.chartCard}>
          <CardHeader title={config.chartTitle} description={config.chartDescription} />
          {config.projection.length > 0 ? (
            <>
              <div className={styles.projectionBadge}>PROYECCIÓN · NO SON DATOS REALES</div>
              <BarChart
                label={config.chartLabel}
                caption={config.projectionCaption}
                series={[{ id: 'projection', name: 'Proyección', data: config.projection }]}
                height={260}
              />
            </>
          ) : (
            <EmptyState
              size="sm"
              illustration="chart"
              title="Visualización pendiente de datos"
              description={`La gráfica se activará cuando esté disponible ${config.endpoints[0] ?? 'el endpoint operativo'}.`}
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Recomendaciones y alertas" description="Siguientes acciones priorizadas" />
          <ul className={styles.alerts}>
            {config.recommendations.map((item) => (
              <li key={item.title} className={styles.alert}>
                <StatusDot tone={item.tone} pulse={item.tone === 'danger'} />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                  <Button variant="link" size="sm" disabled={!permitted}>{item.action}</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card padding="none">
        <div className={styles.listHeader}>
          <CardHeader title={config.listTitle} description={config.listDescription} />
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={config.searchLabel}
            label={config.searchLabel}
          />
        </div>
        {visibleRecords.length === 0 ? (
          <EmptyState
            illustration={query ? 'search' : 'inbox'}
            title={query ? 'No hay coincidencias' : config.emptyTitle}
            description={query ? 'Prueba con otro nombre, estado o identificador.' : config.emptyDescription}
            action={!query ? <Button disabled={!permitted}>{config.emptyAction}</Button> : undefined}
          />
        ) : (
          <ul className={styles.records} aria-label={config.listTitle}>
            {visibleRecords.map((record) => (
              <li key={record.id}>
                <button type="button" className={styles.record} onClick={() => setSelected(record)}>
                  <span><strong>{record.name}</strong><small>{record.meta}</small></span>
                  <span className={styles.recordStatus}>
                    <StatusDot tone={record.statusTone ?? 'neutral'} />
                    {record.status}
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className={styles.secondaryGrid}>
        <Card>
          <CardHeader title="Actividad reciente" description="Cambios auditables del módulo" />
          <ActivityFeed
            items={[]}
            empty={
              <EmptyState
                size="sm"
                illustration="inbox"
                title="Aún no hay actividad"
                description={`La bitácora aparecerá cuando la API publique eventos de ${config.title.toLocaleLowerCase('es-MX')}.`}
              />
            }
          />
        </Card>
        <Card>
          <CardHeader title="Conectividad de datos" description="Contratos necesarios para operar con información real" />
          <ul className={styles.endpoints}>
            {config.endpoints.map((endpoint) => <li key={endpoint}><code>{endpoint}</code></li>)}
          </ul>
        </Card>
      </div>

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.name}
        description={selected?.meta}
        footer={<Button variant="secondary" onClick={() => setSelected(null)}>Cerrar</Button>}
      >
        {selected ? (
          <div className={styles.drawerBody}>
            <span className={styles.recordStatus}><StatusDot tone={selected.statusTone ?? 'neutral'} />{selected.status}</span>
            <p>{selected.detail}</p>
            <EmptyState
              size="sm"
              illustration="chart"
              title="Historial en preparación"
              description="El historial detallado se mostrará cuando el endpoint de detalle esté disponible."
            />
          </div>
        ) : null}
      </Drawer>
    </main>
  );
}
