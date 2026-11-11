/**
 * Cálculos de membresías a partir de los periodos cobrados (`MembershipPeriod`).
 * Sin datos, cero o `null`: nunca una cifra de relleno.
 *
 * Definiciones:
 *  - Vigente en t: tiene un periodo con startsAt ≤ t < endsAt y no estaba
 *    cancelada en t.
 *  - Renovado: un periodo terminado tiene otro periodo de la misma membresía
 *    que empieza a más tardar `RENEWAL_GRACE_DAYS` después de su fin.
 *  - Tasa de renovación: periodos que terminaron en los últimos 12 meses y ya
 *    se pueden juzgar (renovados, o con la gracia vencida) → renovados / juzgables.
 *  - Retención 12 m: de las vigentes hace 365 días, cuántas siguen vigentes hoy.
 *  - Serie de retención: por mes, de las vigentes al inicio del mes, cuántas
 *    siguen vigentes al cierre (o hoy, en el mes en curso). Mes sin base = sin punto.
 *  - Ingreso: suma de periodos que empezaron en los últimos 12 meses.
 *  - MRR: importe mensualizado del periodo vigente de cada membresía vigente.
 */

export const RENEWAL_GRACE_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type BillingPeriod = 'MONTHLY' | 'ANNUAL' | 'SEASON';

export type PeriodLite = {
  startsAt: Date;
  endsAt: Date;
  amount: number;
  createdAt?: Date;
  kind?: string;
};

export type MembershipLite = {
  id: string;
  planId: string;
  expiresAt: Date;
  cancelledAt: Date | null;
  periods: PeriodLite[];
};

/** Meses que cubre un periodo del plan. Temporada = 12 meses. */
export function periodMonths(period: BillingPeriod | string): number {
  return period === 'MONTHLY' ? 1 : 12;
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  const day = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + months);
  // 31 ene + 1 mes → último día de febrero, no 3 de marzo.
  if (next.getUTCDate() < day) next.setUTCDate(0);
  return next;
}

export function isActiveAt(membership: MembershipLite, at: Date): boolean {
  const t = at.getTime();
  if (membership.cancelledAt && membership.cancelledAt.getTime() <= t) return false;
  return membership.periods.some((p) => p.startsAt.getTime() <= t && t < p.endsAt.getTime());
}

export function activeCount(memberships: readonly MembershipLite[], at: Date): number {
  return memberships.filter((m) => isActiveAt(m, at)).length;
}

function sortedPeriods(membership: MembershipLite): PeriodLite[] {
  return [...membership.periods].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Renovados y juzgables entre los periodos que terminaron en [since, now]. */
export function renewalCounts(
  memberships: readonly MembershipLite[],
  now: Date,
  since: Date = new Date(now.getTime() - 365 * DAY_MS)
): { renewed: number; eligible: number } {
  const grace = RENEWAL_GRACE_DAYS * DAY_MS;
  let renewed = 0;
  let eligible = 0;
  for (const membership of memberships) {
    const periods = sortedPeriods(membership);
    periods.forEach((period, index) => {
      const end = period.endsAt.getTime();
      if (end > now.getTime() || end < since.getTime()) return;
      const next = periods.slice(index + 1).find((p) => p.startsAt.getTime() <= end + grace);
      if (next) {
        renewed += 1;
        eligible += 1;
      } else if (end + grace <= now.getTime()) {
        eligible += 1;
      }
    });
  }
  return { renewed, eligible };
}

export function renewalRate(memberships: readonly MembershipLite[], now: Date): number | null {
  const { renewed, eligible } = renewalCounts(memberships, now);
  return eligible > 0 ? round4(renewed / eligible) : null;
}

export function retentionBetween(
  memberships: readonly MembershipLite[],
  from: Date,
  to: Date
): number | null {
  const base = memberships.filter((m) => isActiveAt(m, from));
  if (base.length === 0) return null;
  const kept = base.filter((m) => isActiveAt(m, to)).length;
  return round4(kept / base.length);
}

export function retention12m(memberships: readonly MembershipLite[], now: Date): number | null {
  return retentionBetween(memberships, new Date(now.getTime() - 365 * DAY_MS), now);
}

const MONTH_LABEL = new Intl.DateTimeFormat('es-MX', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function retentionSeries(
  memberships: readonly MembershipLite[],
  now: Date,
  months = 6
): Array<{ label: string; value: number }> {
  const points: Array<{ label: string; value: number }> = [];
  const currentStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  for (let back = months - 1; back >= 0; back -= 1) {
    const start = addMonths(new Date(currentStart), -back);
    const nextStart = addMonths(start, 1);
    // El cierre se mide justo antes del mes siguiente (o ahora, en el mes en curso).
    const end = nextStart.getTime() > now.getTime() ? now : new Date(nextStart.getTime() - 1);
    const value = retentionBetween(memberships, start, end);
    if (value === null) continue;
    points.push({ label: MONTH_LABEL.format(start), value });
  }
  return points;
}

export function revenueSince(memberships: readonly MembershipLite[], since: Date): number {
  let total = 0;
  for (const membership of memberships) {
    for (const period of membership.periods) {
      if (period.startsAt.getTime() >= since.getTime()) total += period.amount;
    }
  }
  return round2(total);
}

export function monthlyRecurring(memberships: readonly MembershipLite[], now: Date): number {
  let total = 0;
  for (const membership of memberships) {
    if (!isActiveAt(membership, now)) continue;
    const t = now.getTime();
    const current = membership.periods.find(
      (p) => p.startsAt.getTime() <= t && t < p.endsAt.getTime()
    );
    if (!current) continue;
    const days = (current.endsAt.getTime() - current.startsAt.getTime()) / DAY_MS;
    const months = Math.max(1, Math.round(days / 30.44));
    total += current.amount / months;
  }
  return round2(total);
}

export type RenewalStatus = 'UPCOMING' | 'DUE' | 'OVERDUE' | 'RENEWED' | 'LAPSED';

/**
 * Estado de renovación de una membresía o `null` si está fuera de la ventana.
 *  RENEWED  renovada en los últimos 30 días.
 *  UPCOMING vence en 8–30 días · DUE vence en ≤ 7 días.
 *  OVERDUE  venció hace ≤ 30 días · LAPSED venció hace 31–90 días.
 */
export function renewalStatus(membership: MembershipLite, now: Date): RenewalStatus | null {
  if (membership.cancelledAt && membership.cancelledAt.getTime() <= now.getTime()) return null;
  const days = (membership.expiresAt.getTime() - now.getTime()) / DAY_MS;
  const lastRenewal = membership.periods
    .filter((p) => p.kind === 'RENEWAL' && p.createdAt)
    .map((p) => p.createdAt!.getTime())
    .sort((a, b) => b - a)[0];
  if (days > 30) {
    return lastRenewal !== undefined && now.getTime() - lastRenewal <= 30 * DAY_MS
      ? 'RENEWED'
      : null;
  }
  if (days > 7) return 'UPCOMING';
  if (days > 0) return 'DUE';
  if (days > -30) return 'OVERDUE';
  if (days > -90) return 'LAPSED';
  return null;
}

/**
 * Siguiente periodo al renovar: arranca al vencer la actual o, si ya caducó
 * más allá de la gracia, hoy (y entonces cuenta como alta nueva, no renovación).
 */
export function nextPeriod(
  expiresAt: Date,
  billingPeriod: BillingPeriod | string,
  now: Date
): { startsAt: Date; endsAt: Date; kind: 'NEW' | 'RENEWAL' } {
  const lapsed = expiresAt.getTime() + RENEWAL_GRACE_DAYS * DAY_MS < now.getTime();
  const startsAt = lapsed ? now : expiresAt;
  return {
    startsAt,
    endsAt: addMonths(startsAt, periodMonths(billingPeriod)),
    kind: lapsed ? 'NEW' : 'RENEWAL',
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
