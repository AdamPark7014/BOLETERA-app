'use client';

import Link from 'next/link';
import { Suspense, useDeferredValue, useMemo } from 'react';
import {
  ActivityFeed,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
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
  type TimelineItem,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import {
  useReservationEvents,
  useReservationInventory,
  useReservationOrders,
  useReservationOrdersMetrics,
} from '@/lib/queries/reservations';
import { useSession } from '@/lib/use-session';
import { ReservationDetailDrawer } from './_components/ReservationDetailDrawer';
import {
  buildReleaseTimeline,
  buildReservationRows,
  conversionFunnel,
  reservationKpis,
} from './_lib/derive';
import {
  daysAgoIso,
  formatCount,
  formatExpiry,
  formatMoney,
  formatRelative,
  formatShare,
  kpiDeltaRatio,
  rangeLabel,
} from './_lib/format';
import {
  KIND_LABEL,
  KIND_TONE,
  KIND_VALUES,
  POLICY_TEMPLATES,
  RANGE_OPTIONS,
  STATUS_LABEL,
  STATUS_TONE,
  STATUS_VALUES,
  type RangeKey,
  type ReservationRow,
} from './_lib/types';
import { useReservationsUrlState } from './_lib/use-reservations-url-state';
import styles from './reservations.module.scss';

function ReservationsCockpit() {
  const { can, organizationId } = useSession();
  const canRead = can('order:read') || can('event:read');
  const url = useReservationsUrlState();
  const deferredQuery = useDeferredValue(url.q);

  const params = useMemo(
    () => ({
      organizationId: organizationId ?? undefined,
      from: daysAgoIso(Number(url.range)),
      to: new Date().toISOString(),
    }),
    [organizationId, url.range],
  );

  const ordersQuery = useReservationOrders({ scope: 'reservations' });
  const inventory = useReservationInventory(params);
  const ordersMetrics = useReservationOrdersMetrics(params);
  const events = useReservationEvents();

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
  const releaseFeed = useMemo(() => buildReleaseTimeline(rows), [rows]);

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase('es-MX');
    return rows.filter((row) => {
      if (url.kinds.length && !url.kinds.includes(row.kind)) return false;
      if (url.statuses.length && !url.statuses.includes(row.status)) return false;
      if (!needle) return true;
      return `${row.title} ${row.meta} ${row.eventTitle} ${row.buyer} ${row.channel}`
        .toLocaleLowerCase('es-MX')
        .includes(needle);
    });
  }, [deferredQuery, rows, url.kinds, url.statuses]);

  const selected = useMemo(
    () => (url.selectedId ? (rows.find((row) => row.id === url.selectedId) ?? null) : null),
    [rows, url.selectedId],
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
        key: 'expiresAt',
        header: 'Expiración',
        width: 140,
        sortValue: (row) => row.expiresAt ?? '',
        render: (row) => formatExpiry(row.expiresAt),
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
    return releaseFeed.map((row) => ({
      id: row.id,
      actor: row.buyer,
      action:
        row.status === 'released'
          ? 'liberó / canceló una reserva'
          : row.status === 'expired'
            ? 'registró expiración de hold'
            : row.status === 'completed'
              ? 'convirtió hold a compra'
              : row.kind === 'zone_hold'
                ? 'retenido inventario de zona'
                : 'mantuvo un hold de checkout',
      target: row.title,
      timestamp: row.createdAt ?? new Date().toISOString(),
      detail: `${row.eventTitle} · ${formatCount(row.quantity)} cupos · ${formatExpiry(row.expiresAt)}`,
    }));
  }, [releaseFeed]);

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
        id: 'expiring',
        title: `${formatCount(kpis.expiringSoon)} por expirar (≤5 min)`,
        description: 'TTL estimado de checkout web (15 min)',
        tone: kpis.expiringSoon > 0 ? 'warning' : 'success',
      },
      {
        id: 'converting',
        title: `${formatMoney(kpis.convertingAmount)} en conversión`,
        description: 'Valor MXN de pedidos pendientes de pago',
        tone: 'warning',
      },
      {
        id: 'released',
        title: `${formatCount(kpis.released)} liberaciones`,
        description: 'Cancelaciones que devuelven cupo al inventario',
        tone: 'neutral',
      },
      {
        id: 'expired',
        title: `${formatCount(kpis.expired)} expiraciones`,
        description: 'Holds / pedidos marcados como vencidos',
        tone: kpis.expired > 0 ? 'danger' : 'success',
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
          description="Necesitas order:read o event:read para monitorear holds, expiraciones y liberaciones."
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
        description="Holds activos, expiración TTL, conversión a compra, liberaciones y timeline operativo derivado de pedidos e inventario."
        breadcrumbs={[
          { label: 'Panel', href: '/dashboard' },
          { label: 'Reservas' },
        ]}
        actions={
          <div className={styles.actions}>
            <SegmentedControl<RangeKey>
              label="Rango de análisis"
              size="sm"
              value={url.range}
              onValueChange={url.setRange}
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
              hint={`${formatCount(kpis.pending)} checkouts · ${formatCount(kpis.expiringSoon)} por expirar · ${rangeLabel(url.range)}`}
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
              label="Liberaciones / expiraciones"
              value={loading ? '—' : formatCount(kpis.released + kpis.expired)}
              hint={`${formatCount(kpis.released)} liberadas · ${formatCount(kpis.expired)} expiradas`}
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
                  value={url.filterSelection}
                  onChange={url.setFilterSelection}
                  search={{
                    value: url.q,
                    onChange: url.setSearch,
                    placeholder: 'Buscar hold, evento, comprador o canal…',
                  }}
                />
                <div className={styles.filterMeta} role="status">
                  <span>
                    {formatNumber(filtered.length)} de {formatNumber(rows.length)} reservas
                  </span>
                  {url.q || url.kinds.length || url.statuses.length ? (
                    <Button type="button" variant="ghost" size="sm" onClick={url.clearFilters}>
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
                        ? 'No hay holds de checkout ni retención de zona. El módulo se actualizará con pedidos pendientes o holds de inventario.'
                        : 'Publica eventos y abre venta para empezar a monitorear holds y bloqueos.'
                    }
                    action={
                      (events.data?.length ?? 0) > 0 ? (
                        <Link href="/orders">
                          <Button type="button">Ver órdenes</Button>
                        </Link>
                      ) : (
                        <Link href="/events/new">
                          <Button type="button">Crear evento</Button>
                        </Link>
                      )
                    }
                    secondaryAction={
                      (events.data?.length ?? 0) > 0 ? (
                        <Link href="/inventory">
                          <Button type="button" variant="secondary">
                            Ver inventario
                          </Button>
                        </Link>
                      ) : (
                        <Link href="/events">
                          <Button type="button" variant="secondary">
                            Catálogo de eventos
                          </Button>
                        </Link>
                      )
                    }
                  />
                ) : (
                  <EmptyState
                    illustration="search"
                    title="Sin coincidencias"
                    description="Ajusta la búsqueda o los filtros de tipo y estado."
                    action={
                      <Button type="button" variant="secondary" onClick={url.clearFilters}>
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
                    url.setSelectedId(row.id === url.selectedId ? null : row.id)
                  }
                />
              )}

              <Card>
                <CardHeader
                  title="Embudo hold → compra"
                  description="Pendientes, convertidos y liberaciones/expiraciones del portafolio"
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
                <CardHeader
                  title="Línea de tiempo operativa"
                  description="Holds → expiración → conversión / liberación"
                />
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
                <CardHeader
                  title="Actividad reciente"
                  description="Conversiones, liberaciones y expiraciones"
                />
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
                <CardHeader title="Señal de pagos" description="Contexto del motor de órdenes" />
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

      <ReservationDetailDrawer
        row={selected}
        onClose={() => url.setSelectedId(null)}
      />
    </main>
  );
}

export default function ReservationsPage() {
  return (
    <Suspense
      fallback={
        <main className={styles.page}>
          <EmptyState title="Cargando reservas…" illustration="seats" />
        </main>
      }
    >
      <ReservationsCockpit />
    </Suspense>
  );
}
