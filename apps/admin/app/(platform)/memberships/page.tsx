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
  useCreateMembershipPlan,
  useMembershipBenefitUsage,
  useMembershipBenefits,
  useMembershipMetrics,
  useMembershipPlans,
  useMembershipRenewals,
  useMembershipRetention,
  useRenewMembership,
  type MembershipPlan,
} from '@/lib/queries/memberships';
import { useSession } from '@/lib/use-session';
import { AdoptionPanel } from './_components/AdoptionPanel';
import { BenefitsPanel } from './_components/BenefitsPanel';
import { CreatePlanModal, type CreatePlanPayload } from './_components/CreatePlanModal';
import { PanelUnavailable } from './_components/PanelState';
import { RenewalPanel } from './_components/RenewalPanel';
import {
  formatCount,
  formatMoney,
  formatMoneyPrecise,
  formatRatio,
} from './_lib/money';
import {
  adoptionByTier,
  adoptionRate,
  billingLabel,
  buildMembershipAlerts,
  computeMembershipKpis,
  filterAndSortPlans,
  planPriceCents,
  planRevenueCents,
  planStatusMeta,
  retentionSeries,
  SORT_OPTIONS,
  STATUS_FILTER_OPTIONS,
  statusOf,
  usageByBenefit,
  type SortKey,
  type StatusFilter,
} from './_lib/plans';
import { isMembershipsUnavailable } from './_lib/status';
import { useMembershipsUrlState } from './_lib/use-memberships-url-state';
import styles from './memberships.module.scss';

function MembershipsCockpit() {
  const { organizationId, status: sessionStatus, can } = useSession();
  const toast = useToast();
  const url = useMembershipsUrlState();
  const deferredQ = useDeferredValue(url.q);
  const canManage = can('memberships.manage');

  const plansQuery = useMembershipPlans(organizationId);
  const metricsQuery = useMembershipMetrics(organizationId);
  const benefitsQuery = useMembershipBenefits(organizationId);
  const usageQuery = useMembershipBenefitUsage(organizationId);
  const renewalsQuery = useMembershipRenewals(organizationId);
  const retentionQuery = useMembershipRetention(organizationId);
  const createPlan = useCreateMembershipPlan(organizationId ?? '');
  const renewMembership = useRenewMembership(organizationId ?? '');

  const [createOpen, setCreateOpen] = useState(false);
  const [renewBusyId, setRenewBusyId] = useState<string | null>(null);

  const plans = plansQuery.data ?? [];
  const renewals = renewalsQuery.data ?? [];
  const benefits = benefitsQuery.data ?? [];
  const kpis = useMemo(
    () => computeMembershipKpis(plans, metricsQuery.data),
    [metricsQuery.data, plans],
  );
  const alerts = useMemo(
    () => buildMembershipAlerts(plans, renewals, benefits),
    [benefits, plans, renewals],
  );
  const buckets = useMemo(() => adoptionByTier(plans), [plans]);
  const usageRows = useMemo(
    () => (usageQuery.data ? usageByBenefit(usageQuery.data) : undefined),
    [usageQuery.data],
  );
  const retentionRows = useMemo(
    () => (retentionQuery.data ? retentionSeries(retentionQuery.data) : undefined),
    [retentionQuery.data],
  );

  const filtered = useMemo(
    () =>
      filterAndSortPlans(plans, {
        query: deferredQ,
        status: url.status,
        sort: url.sort,
      }),
    [deferredQ, plans, url.sort, url.status],
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

  const primaryUnavailable =
    Boolean(plansQuery.error) && isMembershipsUnavailable(plansQuery.error);

  async function onCreate(payload: CreatePlanPayload) {
    if (!organizationId) return;
    await createPlan.mutateAsync(payload);
    setCreateOpen(false);
    toast.success(`Plan «${payload.name}» publicado`);
  }

  async function onRenew(membershipId: string) {
    setRenewBusyId(membershipId);
    try {
      await renewMembership.mutateAsync(membershipId);
      toast.success('Renovación solicitada');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo renovar');
    } finally {
      setRenewBusyId(null);
    }
  }

  const columns: DataTableColumn<MembershipPlan>[] = [
    {
      key: 'name',
      header: 'Plan / tier',
      width: 220,
      sortValue: (row) => row.name,
      render: (row) => (
        <div className={styles.planMeta}>
          <strong>{row.name}</strong>
          <small>
            {row.tier} · {billingLabel(row.billingPeriod)} · {row.slug}
          </small>
        </div>
      ),
    },
    {
      key: 'adoption',
      header: 'Adopción',
      width: 160,
      sortValue: (row) => adoptionRate(row),
      render: (row) => {
        const rate = adoptionRate(row);
        return (
          <div className={styles.adoptionCell}>
            <strong>
              {row.maxMembers != null ? formatRatio(rate) : formatCount(row.memberCount)}
            </strong>
            {row.maxMembers != null ? (
              <div
                className={styles.bar}
                role="meter"
                aria-label={`Adopción ${Math.round(rate * 100)}%`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(rate * 100)}
              >
                <span style={{ width: `${Math.min(rate * 100, 100)}%` }} />
              </div>
            ) : null}
            <small>
              {formatCount(row.memberCount)}
              {row.maxMembers != null ? `/${formatCount(row.maxMembers)}` : ''} miembros
            </small>
          </div>
        );
      },
    },
    {
      key: 'renewal',
      header: 'Renovación',
      width: 110,
      align: 'right',
      sortValue: (row) => row.renewalRate ?? -1,
      render: (row) => (
        <div className={styles.stackCell}>
          <strong>{formatRatio(row.renewalRate)}</strong>
          <small>tasa</small>
        </div>
      ),
    },
    {
      key: 'revenue',
      header: 'Ingreso',
      width: 130,
      align: 'right',
      sortValue: (row) => planRevenueCents(row),
      render: (row) => (
        <div className={styles.stackCell}>
          <strong>{formatMoney(planRevenueCents(row))}</strong>
          <small>{formatMoneyPrecise(planPriceCents(row))} c/u</small>
        </div>
      ),
    },
    {
      key: 'benefits',
      header: 'Beneficios',
      width: 100,
      align: 'right',
      sortValue: (row) => row.benefitCount ?? 0,
      render: (row) => (
        <div className={styles.stackCell}>
          <strong>{formatCount(row.benefitCount ?? 0)}</strong>
          <small>ligados</small>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      width: 120,
      sortValue: (row) => statusOf(row),
      render: (row) => {
        const meta = planStatusMeta(statusOf(row));
        return (
          <Badge tone={meta.tone} variant="soft" size="sm" dot>
            {meta.label}
          </Badge>
        );
      },
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
        eyebrow="Retención y valor recurrente"
        title="Membresías"
        description="Tiers, beneficios, adopción, renovación e ingresos recurrentes con datos reales de la API."
        actions={
          <Button
            type="button"
            disabled={!canManage}
            title={!canManage ? 'Requiere memberships.manage' : undefined}
            onClick={() => setCreateOpen(true)}
          >
            Nuevo plan
          </Button>
        }
      />

      {primaryUnavailable ? (
        <div className={styles.unavailableBanner} role="status">
          <strong>API de membresías pendiente</strong>
          <p>
            Los paneles esperan contratos en /memberships/organization/:orgId. No se muestran
            plantillas ni proyecciones inventadas como métricas reales.
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void plansQuery.refetch()}
          >
            Reintentar
          </Button>
        </div>
      ) : null}

      {alerts.length > 0 && !primaryUnavailable ? (
        <div className={styles.alerts} aria-label="Alertas de membresías">
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

      <Section columns={4} gap="sm" aria-label="Indicadores de membresías">
        <KpiCard
          label="Miembros activos"
          value={primaryUnavailable ? '—' : formatCount(kpis.activeMembers)}
          loading={plansQuery.isPending || metricsQuery.isPending}
          hint={
            metricsQuery.error && isMembershipsUnavailable(metricsQuery.error)
              ? 'Métricas vía API pendientes'
              : `${formatCount(kpis.activePlans)} plan${kpis.activePlans === 1 ? '' : 'es'} activos`
          }
          tone="accent"
        />
        <KpiCard
          label="Beneficios canjeados"
          value={primaryUnavailable ? '—' : formatCount(kpis.benefitsRedeemed)}
          loading={metricsQuery.isPending}
          hint="Desde metrics / usage"
          tone="info"
        />
        <KpiCard
          label="Tasa de renovación"
          value={primaryUnavailable ? '—' : formatRatio(kpis.renewalRate)}
          loading={plansQuery.isPending || metricsQuery.isPending}
          hint="Promedio de planes o metrics"
          tone="success"
        />
        <KpiCard
          label="Ingresos"
          value={primaryUnavailable ? '—' : formatMoney(kpis.revenueCents)}
          loading={plansQuery.isPending || metricsQuery.isPending}
          hint={
            kpis.retention12m != null
              ? `Retención 12m ${formatRatio(kpis.retention12m)}`
              : `${formatCount(kpis.planCount)} planes en catálogo`
          }
          tone="warning"
        />
      </Section>

      <SegmentedControl
        label="Vista de membresías"
        size="sm"
        value={url.tab}
        onValueChange={(value) => url.setTab(value)}
        options={[
          { value: 'tiers', label: 'Tiers y adopción' },
          { value: 'renewals', label: 'Renovación y retención' },
        ]}
      />

      {url.tab === 'renewals' ? (
        <RenewalPanel
          renewals={renewalsQuery.data}
          retention={retentionRows}
          renewalsPending={renewalsQuery.isPending}
          retentionPending={retentionQuery.isPending}
          renewalsError={renewalsQuery.error}
          retentionError={retentionQuery.error}
          onRetryRenewals={() => void renewalsQuery.refetch()}
          onRetryRetention={() => void retentionQuery.refetch()}
          onRenew={canManage ? onRenew : undefined}
          renewBusyId={renewBusyId}
          canManage={canManage}
        />
      ) : plansQuery.error && !isMembershipsUnavailable(plansQuery.error) ? (
        <QueryError error={plansQuery.error} onRetry={() => void plansQuery.refetch()} />
      ) : primaryUnavailable ? (
        <PanelUnavailable onRetry={() => void plansQuery.refetch()} />
      ) : (
        <div className={styles.layout}>
          <Section
            title="Catálogo de planes"
            description="Tiers, cupo, renovación e ingreso estimado por plan."
            actions={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void plansQuery.refetch()}
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
                  const status = (next.status?.[0] as StatusFilter | undefined) ?? 'all';
                  url.setStatus(status);
                }}
                search={{
                  value: url.q,
                  onChange: url.setSearch,
                  placeholder: 'Buscar por nombre, slug o tier',
                }}
              >
                <SegmentedControl
                  label="Filtro rápido de estado"
                  size="sm"
                  value={
                    url.status === 'all' || url.status === 'active' || url.status === 'full'
                      ? url.status
                      : 'all'
                  }
                  onValueChange={(value) => url.setStatus(value)}
                  options={[
                    { value: 'all', label: 'Todos' },
                    { value: 'active', label: 'Activos' },
                    { value: 'full', label: 'Cupo lleno' },
                  ]}
                />
                <select
                  className={styles.sortSelect}
                  aria-label="Ordenar planes"
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
                {formatCount(filtered.length)} de {formatCount(plans.length)} resultados
              </span>
            </div>

            <DataTable
              label="Catálogo de planes de membresía"
              columns={columns}
              data={filtered}
              rowKey={(row) => row.id}
              loading={plansQuery.isPending}
              maxHeight={520}
              rowHeight={64}
              empty={
                <EmptyState
                  title={plans.length === 0 ? 'Sin planes' : 'Sin resultados'}
                  description={
                    plans.length === 0
                      ? 'Crea el primer plan para medir adopción y renovación.'
                      : 'Ajusta filtros o limpia la URL.'
                  }
                  illustration={plans.length === 0 ? 'seats' : 'search'}
                  action={
                    plans.length === 0 ? (
                      <Button
                        type="button"
                        disabled={!canManage}
                        onClick={() => setCreateOpen(true)}
                      >
                        Crear plan
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
            <AdoptionPanel buckets={buckets} loading={plansQuery.isPending} />
            <BenefitsPanel
              usage={usageRows}
              isPending={usageQuery.isPending}
              error={usageQuery.error}
              onRetry={() => void usageQuery.refetch()}
            />
          </div>
        </div>
      )}

      <CreatePlanModal
        open={createOpen}
        busy={createPlan.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={onCreate}
      />
    </div>
  );
}

export default function MembershipsPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page} role="status" aria-live="polite">
          Cargando membresías…
        </div>
      }
    >
      <MembershipsCockpit />
    </Suspense>
  );
}
