'use client';

import { Suspense, useDeferredValue, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  SkeletonCard,
  type DataTableColumn,
  type FilterDefinition,
  type FilterSelection,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  useCreateSponsorshipPackage,
  useSponsorshipActivations,
  useSponsorshipAssets,
  useSponsorshipCompliance,
  useSponsorshipPackages,
  useSponsors,
  type SponsorshipPackage,
} from '@/lib/queries/sponsorships';
import { useSession } from '@/lib/use-session';
import { AssetsPanel } from './_components/AssetsPanel';
import {
  CreatePackageModal,
  type CreatePackagePayload,
} from './_components/CreatePackageModal';
import { DeliverablesPanel } from './_components/DeliverablesPanel';
import { PanelUnavailable } from './_components/PanelState';
import { PipelinePanel } from './_components/PipelinePanel';
import { RoiPanel } from './_components/RoiPanel';
import { formatCount, formatMoney, formatRatio } from './_lib/money';
import {
  assetHealth,
  buildPipeline,
  buildSponsorshipAlerts,
  computeSponsorshipKpis,
  deliverableRate,
  filterAndSortPackages,
  hasRoiData,
  packageRoi,
  packageStatusMeta,
  packageValueCents,
  SORT_OPTIONS,
  STATUS_FILTER_OPTIONS,
  type PackageStatusFilter,
  type SortKey,
} from './_lib/packages';
import { isSponsorshipsUnavailable } from './_lib/status';
import { useSponsorshipsUrlState } from './_lib/use-sponsorships-url-state';
import styles from './sponsorships.module.scss';

function SponsorshipsCockpit() {
  const { organizationId, status: sessionStatus, can } = useSession();
  const toast = useToast();
  const url = useSponsorshipsUrlState();
  const deferredQ = useDeferredValue(url.q);
  const canManage = can('sponsorships.manage');

  const sponsorsQuery = useSponsors(organizationId);
  const assetsQuery = useSponsorshipAssets(organizationId);
  const packagesQuery = useSponsorshipPackages(organizationId);
  const activationsQuery = useSponsorshipActivations(organizationId);
  const complianceQuery = useSponsorshipCompliance(organizationId);
  const createPackage = useCreateSponsorshipPackage(organizationId ?? '');

  const [createOpen, setCreateOpen] = useState(false);

  const packages = useMemo(() => {
    if (packagesQuery.data) return packagesQuery.data;
    if (
      packagesQuery.error &&
      isSponsorshipsUnavailable(packagesQuery.error) &&
      activationsQuery.data
    ) {
      return activationsQuery.data;
    }
    if (!packagesQuery.isPending && !packagesQuery.data && activationsQuery.data) {
      return activationsQuery.data;
    }
    return packagesQuery.data ?? activationsQuery.data ?? [];
  }, [
    activationsQuery.data,
    packagesQuery.data,
    packagesQuery.error,
    packagesQuery.isPending,
  ]);

  const packagesPending =
    packagesQuery.isPending &&
    (activationsQuery.isPending || !activationsQuery.data);

  const packagesUnavailable =
    Boolean(packagesQuery.error) &&
    isSponsorshipsUnavailable(packagesQuery.error) &&
    Boolean(activationsQuery.error) &&
    isSponsorshipsUnavailable(activationsQuery.error) &&
    !packagesQuery.data &&
    !activationsQuery.data;

  const packagesHardError =
    packagesQuery.error &&
    !isSponsorshipsUnavailable(packagesQuery.error) &&
    !packagesQuery.data &&
    !activationsQuery.data;

  const sponsors = sponsorsQuery.data ?? [];
  const assets = assetsQuery.data ?? [];
  const compliance = complianceQuery.data?.summary;
  const issues = complianceQuery.data?.issues;

  const kpis = useMemo(
    () => computeSponsorshipKpis(sponsors, assets, packages, compliance),
    [assets, compliance, packages, sponsors],
  );
  const alerts = useMemo(
    () => buildSponsorshipAlerts(packages, assets, compliance),
    [assets, compliance, packages],
  );
  const pipeline = useMemo(() => buildPipeline(packages), [packages]);
  const assetRows = useMemo(
    () => (assetsQuery.data ? assetHealth(assetsQuery.data) : undefined),
    [assetsQuery.data],
  );

  const filtered = useMemo(
    () =>
      filterAndSortPackages(packages, {
        query: deferredQ,
        status: url.status,
        sort: url.sort,
      }),
    [deferredQ, packages, url.sort, url.status],
  );

  const filterSelection = useMemo<FilterSelection>(() => {
    const next: Record<string, readonly string[]> = {};
    if (url.status !== 'all') next.status = [url.status];
    return next;
  }, [url.status]);

  const filterDefs = useMemo<FilterDefinition[]>(
    () => [
      {
        id: 'status',
        label: 'Estado',
        multiple: false,
        options: STATUS_FILTER_OPTIONS.filter((option) => option.value !== 'all').map(
          (option) => ({ value: option.value, label: option.label }),
        ),
      },
    ],
    [],
  );

  async function onCreate(payload: CreatePackagePayload) {
    if (!organizationId) return;
    await createPackage.mutateAsync(payload);
    setCreateOpen(false);
    toast.success(`Paquete «${payload.name}» creado`);
  }

  const columns: DataTableColumn<SponsorshipPackage>[] = [
    {
      key: 'name',
      header: 'Paquete',
      width: 220,
      sortValue: (row) => row.name,
      render: (row) => (
        <div className={styles.pkgMeta}>
          <strong>{row.name}</strong>
          <small>
            {row.sponsorName ?? 'Sin patrocinador'}
            {row.category ? ` · ${row.category}` : ''}
          </small>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Pipeline',
      width: 130,
      sortValue: (row) => row.status,
      render: (row) => {
        const meta = packageStatusMeta(row.status);
        return (
          <Badge tone={meta.tone} variant="soft" size="sm" dot>
            {meta.label}
          </Badge>
        );
      },
    },
    {
      key: 'value',
      header: 'Valor',
      width: 120,
      align: 'right',
      sortValue: (row) => packageValueCents(row),
      render: (row) => (
        <div className={styles.stackCell}>
          <strong>{formatMoney(packageValueCents(row))}</strong>
          <small>contrato</small>
        </div>
      ),
    },
    {
      key: 'deliverables',
      header: 'Entregables',
      width: 150,
      sortValue: (row) => deliverableRate(row) ?? -1,
      render: (row) => {
        const rate = deliverableRate(row) ?? 0;
        return (
          <div className={styles.adoptionCell}>
            <strong>
              {formatCount(row.deliverablesDone)}/{formatCount(row.deliverablesTotal)}
            </strong>
            <div
              className={styles.bar}
              role="meter"
              aria-label={`Entregables ${Math.round(rate * 100)}%`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(rate * 100)}
            >
              <span style={{ width: `${Math.min(rate * 100, 100)}%` }} />
            </div>
          </div>
        );
      },
    },
    {
      key: 'roi',
      header: 'ROI',
      width: 100,
      align: 'right',
      sortValue: (row) => packageRoi(row) ?? -1,
      render: (row) => (
        <div className={styles.stackCell}>
          <strong>{formatRatio(packageRoi(row))}</strong>
          <small>{row.actualRoi != null ? 'real' : row.estimatedRoi != null ? 'est.' : '—'}</small>
        </div>
      ),
    },
  ];

  if (sessionStatus === 'loading') {
    return (
      <div className={styles.page} aria-busy="true">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={6} />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="Sin organización"
          description="Inicia sesión con una cuenta vinculada a una organización."
          illustration="error"
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Comercial · Patrocinios"
        title="Patrocinios"
        description="Paquetes, assets, pipeline, entregables y ROI cuando el contrato trae datos reales."
        actions={
          <Button
            type="button"
            disabled={!canManage}
            title={!canManage ? 'Requiere sponsorships.manage' : undefined}
            onClick={() => setCreateOpen(true)}
          >
            Nuevo paquete
          </Button>
        }
      />

      {packagesUnavailable ? (
        <div className={styles.unavailableBanner} role="status">
          <strong>API de patrocinios pendiente</strong>
          <p>
            Los paneles esperan /sponsorships/organization/:orgId. No se muestran plantillas ni
            proyecciones inventadas como métricas reales.
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              void packagesQuery.refetch();
              void activationsQuery.refetch();
            }}
          >
            Reintentar
          </Button>
        </div>
      ) : null}

      {alerts.length > 0 && !packagesUnavailable ? (
        <div className={styles.alerts} aria-label="Alertas de patrocinios">
          {alerts.map((alert) => (
            <div key={alert.id} className={styles.alert} role="status">
              <Badge tone={alert.tone} variant="soft" size="sm" dot>
                Atención
              </Badge>
              <span>{alert.text}</span>
            </div>
          ))}
        </div>
      ) : null}

      <Section columns={4} gap="sm" aria-label="Indicadores de patrocinios">
        <KpiCard
          label="Patrocinadores"
          value={packagesUnavailable ? '—' : formatCount(kpis.sponsors)}
          loading={sponsorsQuery.isPending}
          hint={`${formatCount(kpis.activePackages)} paquetes activos`}
          tone="accent"
        />
        <KpiCard
          label="Assets"
          value={packagesUnavailable ? '—' : formatCount(kpis.assets)}
          loading={assetsQuery.isPending}
          hint="Inventario comercial"
          tone="info"
        />
        <KpiCard
          label="Pipeline"
          value={packagesUnavailable ? '—' : formatMoney(kpis.pipelineValueCents)}
          loading={packagesPending}
          hint={
            kpis.deliverableRate != null
              ? `Entregables ${formatRatio(kpis.deliverableRate)}`
              : 'Valor en curso'
          }
          tone="success"
        />
        <KpiCard
          label={hasRoiData(packages) ? 'ROI medio' : 'Cumplimiento'}
          value={
            packagesUnavailable
              ? '—'
              : hasRoiData(packages)
                ? formatRatio(kpis.avgRoi)
                : formatRatio(kpis.complianceRate)
          }
          loading={packagesPending || complianceQuery.isPending}
          hint={
            hasRoiData(packages)
              ? 'Promedio actual/estimado'
              : compliance
                ? `${formatCount(compliance.openIssues)} issues abiertos`
                : 'Sin ROI en contratos'
          }
          tone="warning"
        />
      </Section>

      <SegmentedControl
        label="Vista de patrocinios"
        size="sm"
        value={url.tab}
        onValueChange={(value) => url.setTab(value)}
        options={[
          { value: 'packages', label: 'Paquetes y assets' },
          { value: 'pipeline', label: 'Pipeline y ROI' },
        ]}
      />

      {url.tab === 'pipeline' ? (
        <div className={styles.pipelineGrid}>
          <PipelinePanel stages={pipeline} loading={packagesPending} />
          <div className={styles.stack}>
            <DeliverablesPanel
              summary={compliance}
              issues={issues}
              isPending={complianceQuery.isPending}
              error={complianceQuery.error}
              onRetry={() => void complianceQuery.refetch()}
            />
            <RoiPanel packages={packages} loading={packagesPending} />
          </div>
        </div>
      ) : packagesHardError ? (
        <QueryError
          error={packagesQuery.error}
          onRetry={() => void packagesQuery.refetch()}
        />
      ) : packagesUnavailable ? (
        <PanelUnavailable
          onRetry={() => {
            void packagesQuery.refetch();
            void activationsQuery.refetch();
          }}
        />
      ) : (
        <div className={styles.layout}>
          <Section
            title="Paquetes comerciales"
            description="Contratos, entregables y posición en el pipeline."
            actions={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void packagesQuery.refetch();
                  void activationsQuery.refetch();
                }}
              >
                Actualizar
              </Button>
            }
          >
            <div className={styles.filters}>
              <FilterBar
                filters={filterDefs}
                value={filterSelection}
                onChange={(next) => {
                  const status =
                    (next.status?.[0] as PackageStatusFilter | undefined) ?? 'all';
                  url.setStatus(status);
                }}
                search={{
                  value: url.q,
                  onChange: url.setSearch,
                  placeholder: 'Buscar paquete, sponsor o categoría',
                }}
              >
                <SegmentedControl
                  label="Filtro rápido"
                  size="sm"
                  value={
                    url.status === 'all' ||
                    url.status === 'ACTIVE' ||
                    url.status === 'NEGOTIATION'
                      ? url.status
                      : 'all'
                  }
                  onValueChange={(value) => url.setStatus(value)}
                  options={[
                    { value: 'all', label: 'Todos' },
                    { value: 'ACTIVE', label: 'Activos' },
                    { value: 'NEGOTIATION', label: 'Negociación' },
                  ]}
                />
                <select
                  className={styles.sortSelect}
                  aria-label="Ordenar paquetes"
                  value={url.sort}
                  onChange={(e) => url.setSort(e.target.value as SortKey)}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterBar>
            </div>

            <div className={styles.tableMeta}>
              <span className={styles.muted}>
                {formatCount(filtered.length)} de {formatCount(packages.length)} resultados
              </span>
            </div>

            <DataTable
              label="Paquetes de patrocinio"
              columns={columns}
              data={filtered}
              rowKey={(row) => row.id}
              loading={packagesPending}
              maxHeight={520}
              rowHeight={64}
              empty={
                <EmptyState
                  title={packages.length === 0 ? 'Sin paquetes' : 'Sin resultados'}
                  description={
                    packages.length === 0
                      ? 'Crea el primer paquete para armar pipeline y entregables.'
                      : 'Ajusta filtros o limpia la URL.'
                  }
                  illustration={packages.length === 0 ? 'inbox' : 'search'}
                  action={
                    packages.length === 0 ? (
                      <Button
                        type="button"
                        disabled={!canManage}
                        onClick={() => setCreateOpen(true)}
                      >
                        Crear paquete
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={url.clearFilters}
                      >
                        Limpiar filtros
                      </Button>
                    )
                  }
                />
              }
            />
          </Section>

          <div className={styles.stack}>
            <AssetsPanel
              rows={assetRows}
              isPending={assetsQuery.isPending}
              error={assetsQuery.error}
              onRetry={() => void assetsQuery.refetch()}
            />
            <PipelinePanel stages={pipeline} loading={packagesPending} />
          </div>
        </div>
      )}

      <CreatePackageModal
        open={createOpen}
        busy={createPackage.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={onCreate}
      />
    </div>
  );
}

export default function SponsorshipsPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page} role="status" aria-live="polite">
          Cargando patrocinios…
        </div>
      }
    >
      <SponsorshipsCockpit />
    </Suspense>
  );
}
