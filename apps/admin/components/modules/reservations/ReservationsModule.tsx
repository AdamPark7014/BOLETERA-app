'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import {
  ActivityFeed,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  Drawer,
  EmptyState,
  FilterBar,
  FunnelChart,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  Timeline,
  formatNumber,
  type ActivityItem,
  type DataTableColumn,
  type FilterDefinition,
  type FilterSelection,
  type TimelineItem,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import {
  useEvents,
  useInventoryMetrics,
  useOrders,
  useOrdersMetrics,
} from '@/lib/queries';
import { useSession } from '@/lib/use-session';
import {
  buildReservationRows,
  conversionFunnel,
  reservationKpis,
} from './derive';
import {
  daysAgoIso,
  formatCount,
  formatMoney,
  formatRelative,
  formatShare,
  kpiDeltaRatio,
  rangeLabel,
} from './format';
import {
  KIND_LABEL,
  KIND_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  type RangeKey,
  type ReservationKind,
  type ReservationRow,
  type ReservationStatus,
} from './types';
import styles from './reservations.module.scss';

const RANGE_OPTIONS: ReadonlyArray<{ value: RangeKey; label: string }> = [
  { value: '30', label: '30 días' },
  { value: '90', label: '90 días' },
  { value: '365', label: '12 meses' },
];

const KIND_VALUES: readonly ReservationKind[] = ['checkout', 'zone_hold', 'blocked'];
const STATUS_VALUES: readonly ReservationStatus[] = [
  'active',
  'converting',
  'expired_risk',
  'completed',
];

const POLICY_TEMPLATES = [
  {
    id: 'web-15',
    title: 'TTL checkout web · 15 min',
    detail: 'Libera asientos al expirar el hold de compra en línea.',
  },
  {
    id: 'pos-5',
    title: 'TTL taquilla · 5 min',
    detail: 'Bloqueo corto para ventanilla y evitar aforo atrapado.',
  },
  {
    id: 'vip',
    title: 'Bloqueo VIP / cortesía',
    detail: 'Retención operativa sin TTL de checkout; liberación manual.',
  },
] as const;

export function ReservationsModule() {
  const { can, organizationId } = useSession();
  const canRead = can('order:read') || can('event:read');
  const [range, setRange] = useState<RangeKey>('90');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<FilterSelection>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);

  const params = useMemo(
    () => ({
      organizationId: organizationId ?? undefined,
      from: daysAgoIso(Number(range)),
      to: new Date().toISOString(),
    }),
    [organizationId, range],
  );

  const ordersQuery = useOrders();
  const inventory = useInventoryMetrics(params);
  const ordersMetrics = useOrdersMetrics(params);
  const events = useEvents();

  const rows = useMemo(
    () => buildReservationRows(ordersQuery.data ?? [], inventory.data),
    [inventory.data, ordersQuery.data],
  );
  const kpis = useMemo(
    () => reservationKpis(rows, inventory.data, ordersQuery.data ?? []),
    [inventory.data, ordersQuery.data, rows],
  );
  const funnel = useMemo(
    () => conversionFunnel(ordersQuery.data ?? []),
    [ordersQuery.data],
  );

  const kindFilter = filters.kind ?? [];
  const statusFilter = filters.status ?? [];

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase('es-MX');
    return rows.filter((row) => {
      if (kindFilter.length && !kindFilter.includes(row.kind)) return false;
      if (statusFilter.length && !statusFilter.includes(row.status)) return false;
      if (!needle) return true;
      return `${row.title} ${row.meta} ${row.eventTitle} ${row.buyer} ${row.channel}`
        .toLocaleLowerCase('es-MX')
        .includes(needle);
    });
  }, [deferredQuery, kindFilter, rows, statusFilter]);

  const selected = useMemo(
    () => (selectedId ? (rows.find((row) => row.id === selectedId) ?? null) : null),
    [rows, selectedId],
  );

  const filterDefs = useMemo<FilterDefinition[]>(
    () => [
      {
        id: 'kind',
        label: 'Tipo',
        options: KIND_VALUES.map((value) => ({
          value,
          label: KIND_LABEL[value],
          count: rows.filter((row) => row.kind === value).length,
        })),
      },
      {
        id: 'status',
        label: 'Estado',
        options: STATUS_VALUES.map((value) => ({
          value,
          label: STATUS_LABEL[value],
          count: rows.filter((row) => row.status === value).length,
        })),
      },
    ],
    [rows],
  );

  const columns = useMemo<DataTableColumn<ReservationRow>[]>(
    () => [
      {
        key: 'title',
        header: 'Reserva',
        width: 200,
        sortValue: (row) => row.title,
        render: (row) => (
          <div className={styles.titleCell}>
            <strong>{row.title}</strong>
            <span>{row.meta}</span>
          </div>
        ),
      },
      {
        key: 'kind',
        header: 'Tipo',
        width: 140,
        sortValue: (row) => row.kind,
        render: (row) => (
          <Badge tone={KIND_TONE[row.kind]} variant="soft" size="sm" dot>
            {KIND_LABEL[row.kind]}
          </Badge>
        ),
      },
      {
        key: 'status',
        header: 'Estado',
        width: 130,
        sortValue: (row) => row.status,
        render: (row) => (
          <Badge tone={STATUS_TONE[row.status]} variant="soft" size="sm" dot>
            {STATUS_LABEL[row.status]}
          </Badge>
        ),
      },
      {
        key: 'eventTitle',
        header: 'Evento',
        width: 180,
        sortValue: (row) => row.eventTitle,
      },
      {
        key: 'quantity',
        header: 'Cupos',
        width: 90,
        align: 'right',
        sortValue: (row) => row.quantity,
        render: (row) => formatCount(row.quantity),
      },
      {
        key: 'amount',
        header: 'Valor',
        width: 120,
        align: 'right',
        sortValue: (row) => row.amount,
        render: (row) => (row.amount > 0 ? formatMoney(row.amount, row.currency) : '—'),
      },
      {
        key: 'channel',
        header: 'Canal',
        width: 110,
        sortValue: (row) => row.channel,
      },
      {
        key: 'createdAt',
        header: 'Edad',
        width: 120,
        sortValue: (row) => row.createdAt ?? '',
        render: (row) => formatRelative(row.createdAt),
      },
    ],
    [],
  );

  const activityItems = useMemo<ActivityItem[]>(() => {
    return rows.slice(0, 8).map((row) => ({
      id: row.id,
      actor: row.buyer,
      action:
        row.kind === 'checkout'
          ? 'mantuvo un hold de checkout'
          : row.kind === 'zone_hold'
            ? 'retenido inventario de zona'
            : 'aplicó bloqueo operativo',
      target: row.title,
      timestamp: row.createdAt ?? new Date().toISOString(),
      detail: `${row.eventTitle} · ${formatCount(row.quantity)} cupos`,
    }));
  }, [rows]);

  const timelineItems = useMemo<TimelineItem[]>(() => {
    return [
      {
        id: 'holds',
        title: `${formatCount(kpis.activeHolds)} holds activos`,
        description: 'Reservas de checkout + holds de inventario',
        tone: 'info',
        current: true,
      },
      {
        id: 'converting',
        title: `${formatMoney(kpis.convertingAmount)} en conversión`,
        description: 'Valor MXN de pedidos pendientes de pago',
        tone: 'warning',
      },
      {
        id: 'risk',
        title: `${formatCount(kpis.risk)} con riesgo TTL`,
        description: 'Holds longevos o zonas con alta retención',
        tone: kpis.risk > 0 ? 'danger' : 'success',
      },
      {
        id: 'converted',
        title: `${formatCount(kpis.completed)} convertidos`,
        description: 'Pedidos completados en el portafolio',
        tone: 'success',
      },
    ];
  }, [kpis]);

  const loading = ordersQuery.isPending || inventory.isPending;
  const listError = ordersQuery.error ?? inventory.error;

  if (!canRead) {
    return (
      <main className={styles.page}>
        <EmptyState
          title="Sin permiso para reservas"
          description="Necesitas order:read o event:read para monitorear holds y bloqueos."
          illustration="inbox"
          tone="neutral"
        />
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow="Operaciones · Reservas"
        title="Reservas y bloqueos"
        description="Holds de checkout, retención por zona, bloqueos operativos y conversión a compra. Derivado de pedidos e inventario en vivo."
        breadcrumbs={[
          { label: 'Panel', href: '/dashboard' },
          { label: 'Reservas' },
        ]}
        actions={
          <div className={styles.actions}>
            <SegmentedControl<RangeKey>
              label="Rango de análisis"
              size="sm"
              value={range}
              onValueChange={setRange}
              options={RANGE_OPTIONS}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={ordersQuery.isFetching || inventory.isFetching}
              onClick={() => {
                void ordersQuery.refetch();
                void inventory.refetch();
                void ordersMetrics.refetch();
                void events.refetch();
              }}
            >
              Actualizar
            </Button>
          </div>
        }
      />

      {listError ? (
        <QueryError
          error={listError}
          onRetry={() => {
            void ordersQuery.refetch();
            void inventory.refetch();
          }}
        />
      ) : (
        <>
          <Section columns={4} gap="sm" aria-label="Indicadores de reservas">
            <KpiCard
              label="Reservas activas"
              value={loading ? '—' : formatCount(kpis.activeReservations)}
              hint={`${formatCount(kpis.pending)} checkouts pendientes · ${rangeLabel(range)}`}
              loading={loading}
              tone="info"
            />
            <KpiCard
              label="Holds de zona"
              value={loading ? '—' : formatCount(kpis.zoneHolds)}
              hint={`${formatCount(kpis.activeHolds)} holds activos reportados`}
              loading={loading}
              tone="warning"
            />
            <KpiCard
              label="Bloqueos operativos"
              value={loading ? '—' : formatCount(kpis.blocked)}
              hint="VIP, prensa, producción y cortesía"
              loading={loading}
              tone="neutral"
            />
            <KpiCard
              label="Conversión hold → compra"
              value={loading ? '—' : formatShare(kpis.conversion)}
              delta={kpiDeltaRatio(ordersMetrics.data?.kpis.approvalRate.deltaPercent)}
              deltaLabel="vs. aprobación de pagos"
              hint={`${formatCount(kpis.completed)} convertidos / ${formatCount(kpis.pending + kpis.completed)} base`}
              loading={loading || ordersMetrics.isPending}
              tone="success"
            />
          </Section>

          <div className={styles.layout}>
            <div className={styles.mainCol}>
              <div className={styles.toolbar}>
                <FilterBar
                  filters={filterDefs}
                  value={filters}
                  onChange={setFilters}
                  search={{
                    value: query,
                    onChange: setQuery,
                    placeholder: 'Buscar hold, evento, comprador o canal…',
                  }}
                />
                <div className={styles.filterMeta} role="status">
                  <span>
                    {formatNumber(filtered.length)} de {formatNumber(rows.length)} reservas
                  </span>
                  {query || kindFilter.length || statusFilter.length ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setQuery('');
                        setFilters({});
                      }}
                    >
                      Limpiar
                    </Button>
                  ) : null}
                </div>
              </div>

              {loading ? (
                <DataTable
                  label="Reservas y bloqueos"
                  columns={columns}
                  data={[]}
                  rowKey={(row) => row.id}
                  loading
                  loadingRows={8}
                  maxHeight={480}
                />
              ) : filtered.length === 0 ? (
                rows.length === 0 ? (
                  <EmptyState
                    illustration="seats"
                    title="Sin reservas activas"
                    description={
                      (events.data?.length ?? 0) > 0
                        ? 'No hay holds de checkout ni retención de zona en este momento. El módulo se actualizará cuando existan pedidos pendientes o holds de inventario.'
                        : 'Publica eventos y abre venta para empezar a monitorear holds y bloqueos.'
                    }
                  />
                ) : (
                  <EmptyState
                    illustration="search"
                    title="Sin coincidencias"
                    description="Ajusta la búsqueda o los filtros de tipo y estado."
                    action={
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setQuery('');
                          setFilters({});
                        }}
                      >
                        Limpiar filtros
                      </Button>
                    }
                  />
                )
              ) : (
                <DataTable
                  label="Reservas y bloqueos"
                  columns={columns}
                  data={filtered}
                  rowKey={(row) => row.id}
                  maxHeight={480}
                  density="compact"
                  defaultSort={{ key: 'createdAt', direction: 'desc' }}
                  onRowClick={(row) =>
                    setSelectedId(row.id === selectedId ? null : row.id)
                  }
                />
              )}

              <Card>
                <CardHeader
                  title="Embudo hold → compra"
                  description="Pendientes, convertidos y pérdidas del portafolio de pedidos"
                />
                {funnel.every((stage) => stage.value === 0) ? (
                  <EmptyState
                    size="sm"
                    illustration="chart"
                    title="Sin embudo todavía"
                    description="Cuando existan pedidos pendientes o completados se dibujará la conversión."
                  />
                ) : (
                  <FunnelChart
                    label="Conversión de reservas"
                    stages={[...funnel]}
                    conversionBase="previous"
                    formatValue={(value) => formatCount(value)}
                  />
                )}
              </Card>
            </div>

            <div className={styles.sideCol}>
              <Card>
                <CardHeader title="Línea de tiempo" description="Estado operativo del módulo" />
                <Timeline items={timelineItems} density="sm" label="Estados de reserva" />
              </Card>

              <Card>
                <CardHeader
                  title="Políticas sugeridas"
                  description="Plantillas; no se publican automáticamente"
                />
                <ul className={styles.policyList}>
                  {POLICY_TEMPLATES.map((policy) => (
                    <li key={policy.id} className={styles.policyItem}>
                      <strong>{policy.title}</strong>
                      <p className={styles.muted}>{policy.detail}</p>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card>
                <CardHeader title="Actividad reciente" description="Movimientos derivados" />
                <ActivityFeed
                  items={activityItems}
                  loading={loading}
                  empty={
                    <EmptyState
                      size="sm"
                      illustration="inbox"
                      title="Sin actividad"
                      description="Los holds y liberaciones aparecerán aquí."
                    />
                  }
                />
              </Card>

              <Card>
                <CardHeader
                  title="Señal de pagos"
                  description="Contexto del motor de órdenes"
                />
                <KpiCard
                  label="Tasa de aprobación"
                  value={
                    ordersMetrics.isPending
                      ? '—'
                      : `${formatNumber(ordersMetrics.data?.kpis.approvalRate.value ?? 0, 1)} %`
                  }
                  delta={kpiDeltaRatio(ordersMetrics.data?.kpis.approvalRate.deltaPercent)}
                  loading={ordersMetrics.isPending}
                  tone="success"
                  hint="Útil para interpretar abandono de holds"
                />
              </Card>
            </div>
          </div>
        </>
      )}

      <Drawer
        open={selected !== null}
        onClose={() => setSelectedId(null)}
        title={selected?.title}
        description={selected?.eventTitle}
        footer={
          <Button type="button" variant="secondary" onClick={() => setSelectedId(null)}>
            Cerrar
          </Button>
        }
      >
        {selected ? <ReservationDrawerBody row={selected} /> : null}
      </Drawer>
    </main>
  );
}

function ReservationDrawerBody({ row }: { row: ReservationRow }) {
  return (
    <div className={styles.drawerBody}>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <Badge tone={KIND_TONE[row.kind]} variant="soft" size="sm" dot>
          {KIND_LABEL[row.kind]}
        </Badge>
        <Badge tone={STATUS_TONE[row.status]} variant="soft" size="sm" dot>
          {STATUS_LABEL[row.status]}
        </Badge>
      </div>
      <dl className={styles.metaGrid}>
        <div>
          <dt>Cupos</dt>
          <dd>{formatCount(row.quantity)}</dd>
        </div>
        <div>
          <dt>Valor</dt>
          <dd>{row.amount > 0 ? formatMoney(row.amount, row.currency) : '—'}</dd>
        </div>
        <div>
          <dt>Canal</dt>
          <dd>{row.channel}</dd>
        </div>
        <div>
          <dt>Edad</dt>
          <dd>{formatRelative(row.createdAt)}</dd>
        </div>
        <div>
          <dt>Responsable</dt>
          <dd>{row.buyer}</dd>
        </div>
        <div>
          <dt>Evento</dt>
          <dd>{row.eventTitle}</dd>
        </div>
      </dl>
      <p className={styles.muted}>{row.meta}</p>
      <p className={styles.muted}>
        Liberaciones explícitas requieren POST /reservations/holds/:id/release. Esta vista no inventa
        holds: solo agrega pedidos pendientes e inventario retenido.
      </p>
    </div>
  );
}
