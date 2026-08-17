import type {
  MembershipBenefit,
  MembershipBenefitUsage,
  MembershipMetrics,
  MembershipPlan,
  MembershipRenewal,
  MembershipRetentionPoint,
} from '@/lib/queries/memberships';
import type { BadgeTone } from '@boletera/ui';
import { normalizeRate, safeRatio, toCents, type Cents } from './money';

export type PlanStatus = 'active' | 'inactive' | 'full';
export type StatusFilter = 'all' | PlanStatus;
export type SortKey = 'members' | 'revenue' | 'renewal' | 'name' | 'tier';

export type PlanStatusMeta = {
  id: PlanStatus;
  label: string;
  tone: BadgeTone;
};

const STATUS_META: Record<PlanStatus, PlanStatusMeta> = {
  active: { id: 'active', label: 'Activo', tone: 'success' },
  inactive: { id: 'inactive', label: 'Inactivo', tone: 'neutral' },
  full: { id: 'full', label: 'Cupo lleno', tone: 'warning' },
};

export const STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
  { value: 'full', label: 'Cupo lleno' },
];

export const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: 'members', label: 'Más miembros' },
  { value: 'revenue', label: 'Mayor ingreso' },
  { value: 'renewal', label: 'Mayor renovación' },
  { value: 'tier', label: 'Tier' },
  { value: 'name', label: 'Nombre A–Z' },
];

export function planStatusMeta(status: PlanStatus): PlanStatusMeta {
  return STATUS_META[status];
}

export function planPriceCents(plan: MembershipPlan): Cents {
  return toCents(plan.price);
}

export function planRevenueCents(plan: MembershipPlan): Cents {
  return plan.memberCount * planPriceCents(plan);
}

export function adoptionRate(plan: MembershipPlan): number {
  if (plan.maxMembers == null || plan.maxMembers <= 0) {
    return plan.memberCount > 0 ? 1 : 0;
  }
  return safeRatio(plan.memberCount, plan.maxMembers) ?? 0;
}

export function statusOf(plan: MembershipPlan): PlanStatus {
  if (!plan.active) return 'inactive';
  if (plan.maxMembers != null && plan.memberCount >= plan.maxMembers) return 'full';
  return 'active';
}

export function billingLabel(period: string): string {
  switch (period.toUpperCase()) {
    case 'MONTHLY':
      return 'Mensual';
    case 'ANNUAL':
      return 'Anual';
    case 'SEASON':
      return 'Temporada';
    default:
      return period;
  }
}

export type MembershipKpis = {
  activeMembers: number;
  benefitsRedeemed: number;
  renewalRate: number | null;
  retention12m: number | null;
  revenueCents: Cents;
  planCount: number;
  activePlans: number;
};

export function computeMembershipKpis(
  plans: readonly MembershipPlan[],
  metrics: MembershipMetrics | undefined,
): MembershipKpis {
  const fromPlans = {
    activeMembers: plans.reduce((sum, plan) => sum + plan.memberCount, 0),
    revenueCents: plans.reduce((sum, plan) => sum + planRevenueCents(plan), 0),
    planCount: plans.length,
    activePlans: plans.filter((plan) => plan.active).length,
  };

  const planRenewals = plans
    .map((plan) => normalizeRate(plan.renewalRate ?? null))
    .filter((rate): rate is number => rate !== null);
  const avgPlanRenewal =
    planRenewals.length > 0
      ? planRenewals.reduce((a, b) => a + b, 0) / planRenewals.length
      : null;

  return {
    activeMembers: metrics?.activeMembers ?? fromPlans.activeMembers,
    benefitsRedeemed: metrics?.benefitsRedeemed ?? 0,
    renewalRate: normalizeRate(metrics?.renewalRate) ?? avgPlanRenewal,
    retention12m: normalizeRate(metrics?.retention12m),
    revenueCents: metrics?.revenue != null ? toCents(metrics.revenue) : fromPlans.revenueCents,
    planCount: fromPlans.planCount,
    activePlans: fromPlans.activePlans,
  };
}

export type MembershipAlert = {
  id: string;
  tone: BadgeTone;
  text: string;
};

export function buildMembershipAlerts(
  plans: readonly MembershipPlan[],
  renewals: readonly MembershipRenewal[],
  benefits: readonly MembershipBenefit[],
): MembershipAlert[] {
  const items: MembershipAlert[] = [];
  const inactive = plans.filter((plan) => !plan.active);
  const full = plans.filter((plan) => statusOf(plan) === 'full');
  const overdue = renewals.filter((item) => item.status.toUpperCase() === 'OVERDUE');
  const due = renewals.filter((item) => item.status.toUpperCase() === 'DUE');
  const lowUsage = benefits.filter((benefit) => {
    if (!benefit.active || benefit.redemptionLimit == null || benefit.redemptionLimit <= 0) {
      return false;
    }
    return benefit.redemptionsUsed / benefit.redemptionLimit < 0.15;
  });

  if (overdue.length > 0) {
    items.push({
      id: 'overdue',
      tone: 'danger',
      text: `${overdue.length} renovación${overdue.length === 1 ? '' : 'es'} vencida${overdue.length === 1 ? '' : 's'}. Prioriza retención.`,
    });
  }
  if (due.length > 0) {
    items.push({
      id: 'due',
      tone: 'warning',
      text: `${due.length} renovación${due.length === 1 ? '' : 'es'} por vencer. Activa recordatorios.`,
    });
  }
  if (full.length > 0) {
    items.push({
      id: 'full',
      tone: 'warning',
      text: `${full.length} plan${full.length === 1 ? '' : 'es'} sin cupo. Evalúa ampliar inventario.`,
    });
  }
  if (lowUsage.length > 0) {
    items.push({
      id: 'low-usage',
      tone: 'info',
      text: `${lowUsage.length} beneficio${lowUsage.length === 1 ? '' : 's'} con baja utilización (<15%).`,
    });
  }
  if (inactive.length > 0) {
    items.push({
      id: 'inactive',
      tone: 'neutral',
      text: `${inactive.length} plan${inactive.length === 1 ? '' : 'es'} inactivo${inactive.length === 1 ? '' : 's'} fuera de venta.`,
    });
  }
  return items;
}

export type TierBucket = {
  tier: string;
  plans: number;
  members: number;
  revenueCents: Cents;
  renewalRate: number | null;
};

export function adoptionByTier(plans: readonly MembershipPlan[]): TierBucket[] {
  const map = new Map<string, TierBucket>();
  for (const plan of plans) {
    const tier = plan.tier.trim() || 'Sin tier';
    const current = map.get(tier) ?? {
      tier,
      plans: 0,
      members: 0,
      revenueCents: 0,
      renewalRate: null,
    };
    const rates: number[] = [];
    const existing = normalizeRate(current.renewalRate);
    const next = normalizeRate(plan.renewalRate ?? null);
    if (existing !== null) rates.push(existing);
    if (next !== null) rates.push(next);
    map.set(tier, {
      tier,
      plans: current.plans + 1,
      members: current.members + plan.memberCount,
      revenueCents: current.revenueCents + planRevenueCents(plan),
      renewalRate:
        rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    });
  }
  return [...map.values()].sort((a, b) => b.members - a.members);
}

export function retentionSeries(
  points: readonly MembershipRetentionPoint[],
): Array<{ label: string; value: number }> {
  return points.map((point) => {
    const rate = normalizeRate(point.value) ?? 0;
    return { label: point.label, value: Math.round(rate * 100) };
  });
}

export function usageByBenefit(
  usage: readonly MembershipBenefitUsage[],
): Array<{ label: string; value: number }> {
  return [...usage]
    .sort((a, b) => b.redemptions - a.redemptions)
    .slice(0, 8)
    .map((item) => ({ label: item.benefitName, value: item.redemptions }));
}

export function renewalStatusMeta(status: string): { label: string; tone: BadgeTone } {
  switch (status.toUpperCase()) {
    case 'UPCOMING':
      return { label: 'Próxima', tone: 'info' };
    case 'DUE':
      return { label: 'Por vencer', tone: 'warning' };
    case 'OVERDUE':
      return { label: 'Vencida', tone: 'danger' };
    case 'RENEWED':
      return { label: 'Renovada', tone: 'success' };
    case 'LAPSED':
      return { label: 'Caducada', tone: 'neutral' };
    default:
      return { label: status, tone: 'neutral' };
  }
}

export function filterAndSortPlans(
  plans: readonly MembershipPlan[],
  opts: { query: string; status: StatusFilter; sort: SortKey },
): MembershipPlan[] {
  const needle = opts.query.trim().toLocaleLowerCase('es-MX');
  const filtered = plans.filter((plan) => {
    if (opts.status !== 'all' && statusOf(plan) !== opts.status) return false;
    if (!needle) return true;
    return `${plan.name} ${plan.slug} ${plan.tier} ${plan.billingPeriod}`
      .toLocaleLowerCase('es-MX')
      .includes(needle);
  });

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    switch (opts.sort) {
      case 'revenue':
        return planRevenueCents(b) - planRevenueCents(a);
      case 'renewal':
        return (normalizeRate(b.renewalRate) ?? -1) - (normalizeRate(a.renewalRate) ?? -1);
      case 'tier':
        return a.tier.localeCompare(b.tier, 'es-MX');
      case 'name':
        return a.name.localeCompare(b.name, 'es-MX');
      case 'members':
      default:
        return b.memberCount - a.memberCount;
    }
  });
  return sorted;
}

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
