'use client';

/**
 * Membresías: planes, adopción, beneficios canjeados, renovaciones y retención.
 *
 * Todo sale de `/memberships/organization/:orgId/*`. Si el API responde 404
 * (módulo sin publicar) se dice tal cual: no se inventan plantillas ni cifras.
 * Se conservan las dos escrituras de antes: crear plan y renovar membresía.
 */

import { Suspense, useDeferredValue, useMemo, useState, type FormEvent } from 'react';
import { Field, ParameterCard, TicketButton } from '@boletera/ui';
import { HttpError } from '@/lib/http';
import {
  useCreateMembershipPlan,
  useMembershipBenefitUsage,
  useMembershipBenefits,
  useMembershipMetrics,
  useMembershipPlans,
  useMembershipRenewals,
  useMembershipRetention,
  useRenewMembership,
  type CreateMembershipPlanInput,
} from '@/lib/queries/memberships';
import { useSession as useAppSession } from '@/lib/use-session';
import { AnonymousView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param, Segment, SheetSelect } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { formatCount, formatMoney, formatMoneyPrecise, formatRatio, toCents } from './_lib/money';
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
  renewalStatusMeta,
  retentionSeries,
  slugify,
  SORT_OPTIONS,
  STATUS_FILTER_OPTIONS,
  statusOf,
  usageByBenefit,
  type SortKey,
} from './_lib/plans';
import { isMembershipsUnavailable } from './_lib/status';
import { useMembershipsUrlState } from './_lib/use-memberships-url-state';
import local from './memberships.module.scss';

type Period = 'MONTHLY' | 'ANNUAL' | 'SEASON';

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'ANNUAL', label: 'Anual' },
  { value: 'MONTHLY', label: 'Mensual' },
  { value: 'SEASON', label: 'Temporada' },
];

type FormState = {
  name: string;
  slug: string;
  tier: string;
  price: string;
  billingPeriod: Period;
  maxMembers: string;
  description: string;
  slugTouched: boolean;
};

function defaultForm(): FormState {
  return {
    name: '',
    slug: '',
    tier: 'Premium',
    price: '2499',
    billingPeriod: 'ANNUAL',
    maxMembers: '',
    description: '',
    slugTouched: false,
  };
}

function errorText(error: unknown): string {
  if (error instanceof HttpError) {
    return error.status ? `Error ${error.status} · ${error.message}` : error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Sin respuesta.';
}

/** Estado de un bloque secundario: cargando, sin endpoint, error o vacío. */
function PanelNote({
  pending,
  error,
  empty,
  emptyText,
  path,
  onRetry,
}: {
  pending: boolean;
  error: unknown;
  empty: boolean;
  emptyText: string;
  path: string;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className={styles.stack}>
        <p className={styles.danger} role="alert">
          {isMembershipsUnavailable(error)
            ? `No disponible: ${path} no responde.`
            : errorText(error)}
        </p>
        <div>
          <TicketButton variant="ghost" onClick={onRetry}>
            Reintentar
          </TicketButton>
        </div>
      </div>
    );
  }
  if (pending) return <p className={styles.quiet}>Cargando.</p>;
  if (empty) return <p className={styles.quiet}>{emptyText}</p>;
  return null;
}

export default function MembershipsPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <MembresiasGate />
      </AdminFrame>
    </Suspense>
  );
}

function MembresiasGate() {
  const session = useSession();
  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (session.status === 'loading') return <p className={styles.quiet}>Cargando membresías.</p>;
  return <MembresiasBody orgId={session.orgId} />;
}

function MembresiasBody({ orgId }: { orgId: string }) {
  const { can } = useAppSession();
  const canManage = can('memberships.manage');
  const url = useMembershipsUrlState();
  const deferredQ = useDeferredValue(url.q);

  const plansQuery = useMembershipPlans(orgId);
  const metricsQuery = useMembershipMetrics(orgId);
  const benefitsQuery = useMembershipBenefits(orgId);
  const usageQuery = useMembershipBenefitUsage(orgId);
  const renewalsQuery = useMembershipRenewals(orgId);
  const retentionQuery = useMembershipRetention(orgId);
  const createPlan = useCreateMembershipPlan(orgId);
  const renewMembership = useRenewMembership(orgId);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renewBusyId, setRenewBusyId] = useState<string | null>(null);

  const plans = useMemo(() => plansQuery.data ?? [], [plansQuery.data]);
  const renewals = useMemo(() => renewalsQuery.data ?? [], [renewalsQuery.data]);
  const benefits = useMemo(() => benefitsQuery.data ?? [], [benefitsQuery.data]);
  const kpis = useMemo(
    () => computeMembershipKpis(plans, metricsQuery.data),
    [metricsQuery.data, plans]
  );
  const alerts = useMemo(
    () => buildMembershipAlerts(plans, renewals, benefits),
    [benefits, plans, renewals]
  );
  const buckets = useMemo(() => adoptionByTier(plans), [plans]);
  const usageRows = useMemo(
    () => (usageQuery.data ? usageByBenefit(usageQuery.data) : []),
    [usageQuery.data]
  );
  const retentionRows = useMemo(
    () => (retentionQuery.data ? retentionSeries(retentionQuery.data) : []),
    [retentionQuery.data]
  );
  const filtered = useMemo(
    () => filterAndSortPlans(plans, { query: deferredQ, status: url.status, sort: url.sort }),
    [deferredQ, plans, url.sort, url.status]
  );

  const plansUnavailable = Boolean(plansQuery.error) && isMembershipsUnavailable(plansQuery.error);
  const metricsUnavailable =
    Boolean(metricsQuery.error) && isMembershipsUnavailable(metricsQuery.error);
  const blank = plansUnavailable ? '—' : null;

  async function submitPlan(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const name = form.name.trim();
    if (!name) {
      setFormError('El nombre es obligatorio.');
      return;
    }
    const price = Number(form.price);
    if (!Number.isFinite(price) || price <= 0) {
      setFormError('El precio debe ser mayor a 0.');
      return;
    }
    const maxMembers = form.maxMembers.trim() ? Number(form.maxMembers) : undefined;
    if (maxMembers !== undefined && (!Number.isFinite(maxMembers) || maxMembers < 1)) {
      setFormError('El cupo máximo debe ser un entero positivo.');
      return;
    }
    const payload: CreateMembershipPlanInput = {
      name,
      slug: form.slug.trim() || slugify(name),
      tier: form.tier.trim() || 'Standard',
      price,
      billingPeriod: form.billingPeriod,
      description: form.description.trim() || undefined,
      maxMembers,
    };
    try {
      await createPlan.mutateAsync(payload);
      setNotice(`Plan «${name}» publicado.`);
      setForm(defaultForm());
      setFormOpen(false);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'No se pudo crear el plan.');
    }
  }

  async function renew(membershipId: string) {
    setRenewBusyId(membershipId);
    setActionError(null);
    try {
      await renewMembership.mutateAsync(membershipId);
      setNotice('Renovación registrada.');
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo renovar.');
    } finally {
      setRenewBusyId(null);
    }
  }

  const figuresPending = plansQuery.isPending || metricsQuery.isPending;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Membresías</h1>
        <p className={styles.quiet}>
          Planes, beneficios, adopción, renovación e ingreso recurrente.
        </p>
      </header>

      {plansUnavailable ? (
        <div className={styles.stack}>
          <Param name="API de membresías">
            <ParameterCard
              name="API de membresías"
              value="No disponible"
              effect="Los planes se leen de /memberships/organization/:org. No se muestran plantillas ni proyecciones como cifras reales."
            />
          </Param>
          <p className={styles.danger} role="alert">
            {errorText(plansQuery.error)}
          </p>
          <div>
            <TicketButton variant="secondary" onClick={() => void plansQuery.refetch()}>
              Reintentar
            </TicketButton>
          </div>
        </div>
      ) : null}

      <ul
        className={`${styles.rows} ${plansUnavailable ? local.block : ''}`}
        aria-label="Cifras de membresías"
      >
        <li className={styles.row}>
          <div className={styles.rowMain}>
            <p className={styles.rowTitle}>Miembros activos</p>
            <p className={styles.rowMeta}>
              {metricsUnavailable
                ? 'Métricas no disponibles'
                : `${formatCount(kpis.activePlans)} ${kpis.activePlans === 1 ? 'plan activo' : 'planes activos'}`}
            </p>
          </div>
          <span />
          <p className={styles.figure}>
            {blank ?? (figuresPending ? '…' : formatCount(kpis.activeMembers))}
          </p>
        </li>
        <li className={styles.row}>
          <div className={styles.rowMain}>
            <p className={styles.rowTitle}>Beneficios canjeados</p>
            <p className={styles.rowMeta}>Según métricas</p>
          </div>
          <span />
          <p className={styles.figure}>
            {blank ?? (metricsQuery.isPending ? '…' : formatCount(kpis.benefitsRedeemed))}
          </p>
        </li>
        <li className={styles.row}>
          <div className={styles.rowMain}>
            <p className={styles.rowTitle}>Tasa de renovación</p>
            <p className={styles.rowMeta}>Promedio de planes o métricas</p>
          </div>
          <span />
          <p className={styles.figure}>
            {blank ?? (figuresPending ? '…' : formatRatio(kpis.renewalRate))}
          </p>
        </li>
        <li className={styles.row}>
          <div className={styles.rowMain}>
            <p className={styles.rowTitle}>Ingresos</p>
            <p className={styles.rowMeta}>
              {kpis.retention12m != null
                ? `Retención a 12 meses ${formatRatio(kpis.retention12m)}`
                : `${formatCount(kpis.planCount)} planes en catálogo`}
            </p>
          </div>
          <span />
          <p className={styles.figure}>
            {blank ?? (figuresPending ? '…' : formatMoney(kpis.revenueCents))}
          </p>
        </li>
      </ul>
      {metricsQuery.error && !plansUnavailable ? (
        <p className={styles.tertiary} role="status">
          Métricas: {errorText(metricsQuery.error)}
        </p>
      ) : null}

      {alerts.length > 0 && !plansUnavailable ? (
        <div className={local.block}>
          <p className={local.subTitle}>Atención</p>
          <ul className={styles.rows}>
            {alerts.map((alert) => (
              <li key={alert.id} className={styles.row}>
                <p className={alert.tone === 'danger' ? styles.out : styles.quiet}>{alert.text}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={`${styles.stack} ${local.block}`}>
        <Segment
          label="Vista de membresías"
          value={url.tab}
          options={[
            { value: 'tiers', label: 'Planes y adopción' },
            { value: 'renewals', label: 'Renovación y retención' },
          ]}
          onChange={(value) => url.setTab(value)}
        />
      </div>

      {url.tab === 'renewals' ? (
        <>
          <div className={local.block}>
            <p className={local.subTitle}>Renovaciones</p>
            <PanelNote
              pending={renewalsQuery.isPending}
              error={renewalsQuery.error}
              empty={renewals.length === 0}
              emptyText="No hay membresías en ventana de renovación."
              path="/renewals"
              onRetry={() => void renewalsQuery.refetch()}
            />
            {renewals.length > 0 ? (
              <ul className={styles.rows}>
                {renewals.slice(0, 10).map((item) => {
                  const due = ['DUE', 'OVERDUE'].includes(item.status.toUpperCase());
                  return (
                    <li key={item.id} className={styles.row}>
                      <div className={styles.rowMain}>
                        <p className={styles.rowTitle}>{item.memberName}</p>
                        <p className={styles.rowMeta}>
                          {item.planName} · vence{' '}
                          {new Date(item.expiresAt).toLocaleDateString('es-MX')} ·{' '}
                          {renewalStatusMeta(item.status).label}
                        </p>
                      </div>
                      <p className={styles.figure}>
                        {item.amount != null ? formatMoney(toCents(item.amount)) : '—'}
                      </p>
                      {canManage && due ? (
                        <TicketButton
                          variant="secondary"
                          disabled={renewBusyId === item.membershipId}
                          onClick={() => void renew(item.membershipId)}
                        >
                          Renovar
                        </TicketButton>
                      ) : (
                        <span />
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
          <div className={local.block}>
            <p className={local.subTitle}>Retención</p>
            <PanelNote
              pending={retentionQuery.isPending}
              error={retentionQuery.error}
              empty={retentionRows.length === 0}
              emptyText="Sin serie de retención."
              path="/retention"
              onRetry={() => void retentionQuery.refetch()}
            />
            {retentionRows.length > 0 ? (
              <ul className={styles.rows}>
                {retentionRows.map((point) => (
                  <li key={point.label} className={styles.row}>
                    <p className={styles.rowTitle}>{point.label}</p>
                    <span />
                    <p className={styles.figure}>{point.value}%</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      ) : plansUnavailable ? null : (
        <>
          <div className={local.block}>
            <p className={local.subTitle}>Planes</p>
            {plansQuery.error ? (
              <PanelNote
                pending={false}
                error={plansQuery.error}
                empty={false}
                emptyText=""
                path="/plans"
                onRetry={() => void plansQuery.refetch()}
              />
            ) : (
              <div className={styles.stack}>
                <div className={local.tools}>
                  <Field
                    label="Buscar"
                    kind="search"
                    value={url.q}
                    placeholder="Nombre, slug o tier"
                    onChange={(event) => url.setSearch(event.target.value)}
                  />
                  <div>
                    <p className={local.label}>Orden</p>
                    <SheetSelect
                      label="Ordenar planes"
                      value={url.sort}
                      placeholder="Orden"
                      options={SORT_OPTIONS.map((option) => ({
                        value: option.value,
                        label: option.label,
                      }))}
                      onChange={(value) => url.setSort(value as SortKey)}
                    />
                  </div>
                </div>
                <Segment
                  label="Estado del plan"
                  value={url.status}
                  options={STATUS_FILTER_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  onChange={(value) => url.setStatus(value)}
                />
                {plansQuery.isPending ? <p className={styles.quiet}>Cargando planes.</p> : null}
                {!plansQuery.isPending && plans.length === 0 ? (
                  <p className={styles.quiet}>
                    Sin planes. Crea el primero para medir adopción y renovación.
                  </p>
                ) : null}
                {plans.length > 0 && filtered.length === 0 ? (
                  <div className={styles.stack}>
                    <p className={styles.quiet}>Ningún plan con ese criterio.</p>
                    <div>
                      <TicketButton variant="ghost" onClick={url.clearFilters}>
                        Limpiar filtros
                      </TicketButton>
                    </div>
                  </div>
                ) : null}
                {filtered.length > 0 ? (
                  <>
                    <p className={styles.tertiary}>
                      {formatCount(filtered.length)} de {formatCount(plans.length)}
                    </p>
                    <ul className={styles.rows}>
                      {filtered.map((plan) => (
                        <li key={plan.id} className={styles.row}>
                          <div className={styles.rowMain}>
                            <p className={styles.rowTitle}>{plan.name}</p>
                            <p className={styles.rowMeta}>
                              {[
                                plan.tier,
                                billingLabel(plan.billingPeriod),
                                plan.slug,
                                planStatusMeta(statusOf(plan)).label,
                                `${formatMoneyPrecise(planPriceCents(plan))} c/u`,
                                `${formatCount(plan.benefitCount ?? 0)} beneficios`,
                                `renovación ${formatRatio(plan.renewalRate)}`,
                              ].join(' · ')}
                            </p>
                          </div>
                          <p className={styles.tertiary}>
                            {formatCount(plan.memberCount)}
                            {plan.maxMembers != null
                              ? `/${formatCount(plan.maxMembers)} · ${formatRatio(adoptionRate(plan))}`
                              : ' miembros'}
                          </p>
                          <p className={styles.figure}>{formatMoney(planRevenueCents(plan))}</p>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            )}
          </div>

          <div className={local.block}>
            <p className={local.subTitle}>Adopción por tier</p>
            {plansQuery.isPending ? <p className={styles.quiet}>Cargando.</p> : null}
            {!plansQuery.isPending && buckets.length === 0 ? (
              <p className={styles.quiet}>Sin tiers. Aparecen al publicar planes.</p>
            ) : null}
            {buckets.length > 0 ? (
              <ul className={styles.rows}>
                {buckets.map((item) => (
                  <li key={item.tier} className={styles.row}>
                    <div className={styles.rowMain}>
                      <p className={styles.rowTitle}>{item.tier}</p>
                      <p className={styles.rowMeta}>
                        {formatCount(item.plans)} plan{item.plans === 1 ? '' : 'es'} ·{' '}
                        {formatMoney(item.revenueCents)}
                        {item.renewalRate != null
                          ? ` · renovación ${formatRatio(item.renewalRate)}`
                          : ''}
                      </p>
                    </div>
                    <span />
                    <p className={styles.figure}>{formatCount(item.members)}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className={local.block}>
            <p className={local.subTitle}>Beneficios canjeados</p>
            <PanelNote
              pending={usageQuery.isPending}
              error={usageQuery.error}
              empty={usageRows.length === 0}
              emptyText="Aún no hay canjes registrados."
              path="/benefits/usage"
              onRetry={() => void usageQuery.refetch()}
            />
            {usageRows.length > 0 ? (
              <ul className={styles.rows}>
                {usageRows.map((row) => (
                  <li key={row.label} className={styles.row}>
                    <p className={styles.rowTitle}>{row.label}</p>
                    <span />
                    <p className={styles.figure}>{formatCount(row.value)}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      )}

      {formOpen ? (
        <form
          className={`${local.form} ${local.block}`}
          onSubmit={(event) => void submitPlan(event)}
        >
          <p className={`${local.subTitle} ${local.formWide}`}>Nuevo plan</p>
          <Field
            label="Nombre"
            value={form.name}
            autoFocus
            onChange={(event) => {
              const name = event.target.value;
              setForm((prev) => ({
                ...prev,
                name,
                slug: prev.slugTouched ? prev.slug : slugify(name),
              }));
            }}
          />
          <Field
            label="Slug"
            value={form.slug}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, slug: event.target.value, slugTouched: true }))
            }
          />
          <Field
            label="Tier"
            value={form.tier}
            onChange={(event) => setForm((prev) => ({ ...prev, tier: event.target.value }))}
          />
          <Field
            label="Precio"
            kind="money"
            trailing="MXN"
            value={form.price}
            onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
          />
          <div>
            <p className={local.label}>Periodo</p>
            <Segment
              label="Periodo"
              value={form.billingPeriod}
              options={PERIOD_OPTIONS}
              onChange={(value) => setForm((prev) => ({ ...prev, billingPeriod: value }))}
            />
          </div>
          <Field
            label="Cupo máximo"
            hint="Opcional"
            inputMode="numeric"
            value={form.maxMembers}
            onChange={(event) => setForm((prev) => ({ ...prev, maxMembers: event.target.value }))}
          />
          <div className={local.formWide}>
            <Field
              label="Descripción"
              hint="Opcional"
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
            />
          </div>
          {formError ? (
            <p className={`${styles.danger} ${local.formWide}`} role="alert">
              {formError}
            </p>
          ) : null}
          <div className={`${local.actions} ${local.formWide}`}>
            <TicketButton type="submit" disabled={createPlan.isPending}>
              {createPlan.isPending ? 'Creando' : 'Crear plan'}
            </TicketButton>
            <TicketButton
              type="button"
              variant="ghost"
              disabled={createPlan.isPending}
              onClick={() => {
                setForm(defaultForm());
                setFormError(null);
                setFormOpen(false);
              }}
            >
              Cancelar
            </TicketButton>
          </div>
        </form>
      ) : null}

      {actionError ? (
        <p className={styles.danger} role="alert">
          {actionError}
        </p>
      ) : null}

      <div className={styles.saveBar}>
        <p className={styles.quiet} aria-live="polite">
          {notice ?? (canManage ? '' : 'Tu rol consulta; crear planes pide permiso de membresías.')}
        </p>
        {!formOpen ? (
          <TicketButton
            disabled={!canManage}
            onClick={() => {
              setNotice(null);
              setFormOpen(true);
            }}
          >
            Nuevo plan
          </TicketButton>
        ) : null}
      </div>
    </section>
  );
}
