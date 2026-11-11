import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  activeCount,
  addMonths,
  DAY_MS,
  monthlyRecurring,
  nextPeriod,
  periodMonths,
  renewalRate,
  renewalStatus,
  retention12m,
  retentionSeries,
  revenueSince,
  type MembershipLite,
} from './membership-math';

const BILLING_PERIODS = ['MONTHLY', 'ANNUAL', 'SEASON'] as const;

/** Días antes del vencimiento en que se admite registrar la renovación. */
export const RENEW_WINDOW_DAYS = 30;
type BillingPeriod = (typeof BILLING_PERIODS)[number];

/** Quién actúa y sobre qué organización (null solo para SUPER_ADMIN sin tenant). */
export type MembershipActor = {
  userId?: string;
  role?: string;
  scopedOrganizationId: string | null;
};

export type CreatePlanInput = {
  name?: unknown;
  slug?: unknown;
  tier?: unknown;
  price?: unknown;
  billingPeriod?: unknown;
  description?: unknown;
  maxMembers?: unknown;
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function validatePlanInput(body: CreatePlanInput) {
  const name = text(body.name, 120);
  if (!name) throw new BadRequestException('El nombre es obligatorio');
  const slug = text(body.slug, 64).toLowerCase();
  if (!slug || !SLUG_RE.test(slug)) {
    throw new BadRequestException('El slug solo admite minúsculas, números y guiones');
  }
  const tier = text(body.tier, 60) || 'Standard';
  const price = typeof body.price === 'string' ? Number(body.price) : body.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > 10_000_000) {
    throw new BadRequestException('El precio debe ser mayor a 0');
  }
  const billingPeriod = text(body.billingPeriod, 16).toUpperCase() || 'ANNUAL';
  if (!(BILLING_PERIODS as readonly string[]).includes(billingPeriod)) {
    throw new BadRequestException('Periodo inválido: MONTHLY, ANNUAL o SEASON');
  }
  let maxMembers: number | null = null;
  if (body.maxMembers !== undefined && body.maxMembers !== null && body.maxMembers !== '') {
    const parsed = Number(body.maxMembers);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException('El cupo máximo debe ser un entero positivo');
    }
    maxMembers = parsed;
  }
  return {
    name,
    slug,
    tier,
    price: Math.round(price * 100) / 100,
    billingPeriod: billingPeriod as BillingPeriod,
    description: text(body.description, 1000) || null,
    maxMembers,
  };
}

function lite(membership: {
  id: string;
  planId: string;
  expiresAt: Date;
  cancelledAt: Date | null;
  periods: Array<{
    startsAt: Date;
    endsAt: Date;
    amount: Prisma.Decimal;
    createdAt: Date;
    kind: string;
  }>;
}): MembershipLite {
  return {
    id: membership.id,
    planId: membership.planId,
    expiresAt: membership.expiresAt,
    cancelledAt: membership.cancelledAt,
    periods: membership.periods.map((p) => ({
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      amount: Number(p.amount),
      createdAt: p.createdAt,
      kind: p.kind,
    })),
  };
}

@Injectable()
export class MembershipsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService
  ) {}

  private async loadMemberships(organizationId: string) {
    const rows = await this.prisma.membership.findMany({
      where: { organizationId },
      include: { periods: true },
    });
    return rows.map(lite);
  }

  async listPlans(organizationId: string, now = new Date()) {
    const [plans, memberships] = await Promise.all([
      this.prisma.membershipPlan.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
        include: { _count: { select: { benefits: true } } },
      }),
      this.loadMemberships(organizationId),
    ]);
    return plans.map((plan) => {
      const own = memberships.filter((m) => m.planId === plan.id);
      return {
        id: plan.id,
        name: plan.name,
        slug: plan.slug,
        tier: plan.tier,
        description: plan.description,
        price: plan.price.toString(),
        currency: plan.currency,
        billingPeriod: plan.billingPeriod,
        active: plan.active,
        memberCount: activeCount(own, now),
        maxMembers: plan.maxMembers,
        benefitCount: plan._count.benefits,
        renewalRate: renewalRate(own, now),
        createdAt: plan.createdAt.toISOString(),
      };
    });
  }

  async createPlan(organizationId: string, body: CreatePlanInput, actor: MembershipActor) {
    const input = validatePlanInput(body ?? {});
    try {
      const plan = await this.prisma.membershipPlan.create({
        data: { organizationId, ...input, price: new Prisma.Decimal(input.price) },
      });
      await this.audit.log({
        action: 'MEMBERSHIP_PLAN_CREATED',
        entityType: 'MembershipPlan',
        entityId: plan.id,
        organizationId,
        userId: actor.userId,
        metadata: { name: plan.name, price: input.price, billingPeriod: plan.billingPeriod },
      });
      return {
        id: plan.id,
        name: plan.name,
        slug: plan.slug,
        tier: plan.tier,
        description: plan.description,
        price: plan.price.toString(),
        currency: plan.currency,
        billingPeriod: plan.billingPeriod,
        active: plan.active,
        memberCount: 0,
        maxMembers: plan.maxMembers,
        benefitCount: 0,
        renewalRate: null,
        createdAt: plan.createdAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya existe un plan con ese slug');
      }
      throw error;
    }
  }

  async metrics(organizationId: string, now = new Date()) {
    const [memberships, benefitsRedeemed] = await Promise.all([
      this.loadMemberships(organizationId),
      this.prisma.membershipBenefitRedemption.count({ where: { organizationId } }),
    ]);
    return {
      activeMembers: activeCount(memberships, now),
      benefitsRedeemed,
      renewalRate: renewalRate(memberships, now),
      retention12m: retention12m(memberships, now),
      /** Cobrado en periodos iniciados en los últimos 12 meses. */
      revenue: revenueSince(memberships, new Date(now.getTime() - 365 * DAY_MS)).toFixed(2),
      mrr: monthlyRecurring(memberships, now).toFixed(2),
    };
  }

  async benefits(organizationId: string) {
    const rows = await this.prisma.membershipBenefit.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      include: { plan: { select: { name: true } }, _count: { select: { redemptions: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      planId: row.planId,
      planName: row.plan.name,
      redemptionLimit: row.redemptionLimit,
      redemptionsUsed: row._count.redemptions,
      active: row.active,
    }));
  }

  async benefitUsage(organizationId: string) {
    const [benefits, grouped] = await Promise.all([
      this.prisma.membershipBenefit.findMany({
        where: { organizationId },
        select: { id: true, name: true },
      }),
      this.prisma.membershipBenefitRedemption.groupBy({
        by: ['benefitId', 'membershipId'],
        where: { organizationId },
        _count: { _all: true },
      }),
    ]);
    const names = new Map(benefits.map((b) => [b.id, b.name]));
    const usage = new Map<string, { redemptions: number; members: number }>();
    for (const row of grouped) {
      const current = usage.get(row.benefitId) ?? { redemptions: 0, members: 0 };
      current.redemptions += row._count._all;
      current.members += 1;
      usage.set(row.benefitId, current);
    }
    return [...usage.entries()]
      .map(([benefitId, item]) => ({
        benefitId,
        benefitName: names.get(benefitId) ?? benefitId,
        redemptions: item.redemptions,
        uniqueMembers: item.members,
      }))
      .sort((a, b) => b.redemptions - a.redemptions);
  }

  async renewals(organizationId: string, now = new Date()) {
    const rows = await this.prisma.membership.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        expiresAt: { gte: new Date(now.getTime() - 90 * DAY_MS) },
      },
      include: {
        periods: true,
        plan: { select: { name: true, price: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { expiresAt: 'asc' },
    });
    const out = [];
    for (const row of rows) {
      const status = renewalStatus(lite(row), now);
      if (!status) continue;
      out.push({
        id: row.id,
        membershipId: row.id,
        memberName: `${row.user.firstName} ${row.user.lastName}`.trim() || row.user.email,
        memberEmail: row.user.email,
        planName: row.plan.name,
        expiresAt: row.expiresAt.toISOString(),
        status,
        amount: row.plan.price.toString(),
      });
    }
    return out;
  }

  async retention(organizationId: string, now = new Date()) {
    return retentionSeries(await this.loadMemberships(organizationId), now);
  }

  async activity(organizationId: string) {
    const rows = await this.prisma.auditEvent.findMany({
      where: { organizationId, action: { startsWith: 'MEMBERSHIP_' } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      actor: row.userId,
      target: row.entityId,
      detail: row.metadata ? JSON.stringify(row.metadata).slice(0, 300) : null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * Registra la renovación: un periodo más al precio vigente del plan. No cobra:
   * deja constancia de un cobro hecho fuera (taquilla, transferencia).
   */
  async renew(membershipId: string, actor: MembershipActor, now = new Date()) {
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      include: { plan: true },
    });
    if (!membership || !this.canTouch(actor, membership.organizationId)) {
      throw new NotFoundException('Membresía no encontrada');
    }
    if (membership.status === 'CANCELLED') {
      throw new ConflictException('La membresía está cancelada');
    }
    if (!membership.plan.active) {
      throw new ConflictException('El plan está inactivo: no admite renovaciones');
    }
    // Solo dentro de la ventana de renovación: evita registrar dos veces un mismo cobro.
    if (membership.expiresAt.getTime() - now.getTime() > RENEW_WINDOW_DAYS * DAY_MS) {
      throw new ConflictException(
        `Aún no está en ventana de renovación (se abre ${RENEW_WINDOW_DAYS} días antes de vencer)`
      );
    }
    const next = nextPeriod(membership.expiresAt, membership.plan.billingPeriod, now);
    const amount = membership.plan.price;
    await this.prisma.$transaction([
      this.prisma.membershipPeriod.create({
        data: {
          organizationId: membership.organizationId,
          membershipId: membership.id,
          kind: next.kind,
          startsAt: next.startsAt,
          endsAt: next.endsAt,
          amount,
          recordedById: actor.userId ?? null,
        },
      }),
      this.prisma.membership.update({
        where: { id: membership.id },
        data: { expiresAt: next.endsAt },
      }),
    ]);
    await this.audit.log({
      action: 'MEMBERSHIP_RENEWED',
      entityType: 'Membership',
      entityId: membership.id,
      organizationId: membership.organizationId,
      userId: actor.userId,
      metadata: { kind: next.kind, endsAt: next.endsAt.toISOString(), amount: amount.toString() },
    });
    return {
      id: membership.id,
      status: 'RENEWED' as const,
      kind: next.kind,
      expiresAt: next.endsAt.toISOString(),
      amount: amount.toString(),
    };
  }

  /** Alta de un usuario existente en un plan (cobro registrado fuera). */
  async enroll(
    organizationId: string,
    body: { planId?: unknown; userEmail?: unknown },
    actor: MembershipActor,
    now = new Date()
  ) {
    const planId = text(body?.planId, 64);
    const email = text(body?.userEmail, 255).toLowerCase();
    if (!planId || !email) throw new BadRequestException('planId y userEmail son obligatorios');
    const plan = await this.prisma.membershipPlan.findFirst({
      where: { id: planId, organizationId },
    });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    if (!plan.active) throw new ConflictException('El plan está inactivo');
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new NotFoundException('No hay una cuenta con ese correo');
    if (plan.maxMembers != null) {
      const own = (
        await this.prisma.membership.findMany({ where: { planId }, include: { periods: true } })
      ).map(lite);
      if (activeCount(own, now) >= plan.maxMembers) {
        throw new ConflictException('El plan no tiene cupo');
      }
    }
    const existing = await this.prisma.membership.findUnique({
      where: { planId_userId: { planId, userId: user.id } },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Esa cuenta ya tiene este plan; usa renovar');
    const endsAt = addMonths(now, periodMonths(plan.billingPeriod));
    const membership = await this.prisma.membership.create({
      data: {
        organizationId,
        planId,
        userId: user.id,
        startedAt: now,
        expiresAt: endsAt,
        periods: {
          create: {
            organizationId,
            kind: 'NEW',
            startsAt: now,
            endsAt,
            amount: plan.price,
            recordedById: actor.userId ?? null,
          },
        },
      },
    });
    await this.audit.log({
      action: 'MEMBERSHIP_ENROLLED',
      entityType: 'Membership',
      entityId: membership.id,
      organizationId,
      userId: actor.userId,
      metadata: { planId },
    });
    return { id: membership.id, planId, expiresAt: endsAt.toISOString() };
  }

  async createBenefit(
    organizationId: string,
    planId: string,
    body: { name?: unknown; type?: unknown; description?: unknown; redemptionLimit?: unknown },
    actor: MembershipActor
  ) {
    const plan = await this.prisma.membershipPlan.findFirst({
      where: { id: planId, organizationId },
    });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    const name = text(body?.name, 120);
    if (!name) throw new BadRequestException('El nombre es obligatorio');
    let redemptionLimit: number | null = null;
    if (
      body?.redemptionLimit !== undefined &&
      body?.redemptionLimit !== null &&
      body?.redemptionLimit !== ''
    ) {
      const parsed = Number(body.redemptionLimit);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new BadRequestException('El tope de canjes debe ser un entero positivo');
      }
      redemptionLimit = parsed;
    }
    const benefit = await this.prisma.membershipBenefit.create({
      data: {
        organizationId,
        planId,
        name,
        type: text(body?.type, 40).toUpperCase() || 'OTHER',
        description: text(body?.description, 1000) || null,
        redemptionLimit,
      },
    });
    await this.audit.log({
      action: 'MEMBERSHIP_BENEFIT_CREATED',
      entityType: 'MembershipBenefit',
      entityId: benefit.id,
      organizationId,
      userId: actor.userId,
      metadata: { planId, name },
    });
    return benefit;
  }

  async redeem(
    organizationId: string,
    benefitId: string,
    body: { membershipId?: unknown; note?: unknown },
    actor: MembershipActor,
    now = new Date()
  ) {
    const membershipId = text(body?.membershipId, 64);
    if (!membershipId) throw new BadRequestException('membershipId es obligatorio');
    const benefit = await this.prisma.membershipBenefit.findFirst({
      where: { id: benefitId, organizationId },
      include: { _count: { select: { redemptions: true } } },
    });
    if (!benefit) throw new NotFoundException('Beneficio no encontrado');
    if (!benefit.active) throw new ConflictException('El beneficio está inactivo');
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId },
      include: { periods: true },
    });
    if (!membership) throw new NotFoundException('Membresía no encontrada');
    if (membership.planId !== benefit.planId) {
      throw new ConflictException('El beneficio no pertenece al plan de esta membresía');
    }
    if (!activeCount([lite(membership)], now)) {
      throw new ConflictException('La membresía no está vigente');
    }
    if (benefit.redemptionLimit != null && benefit._count.redemptions >= benefit.redemptionLimit) {
      throw new ConflictException('El beneficio alcanzó su tope de canjes');
    }
    const redemption = await this.prisma.membershipBenefitRedemption.create({
      data: {
        organizationId,
        benefitId,
        membershipId,
        note: text(body?.note, 300) || null,
        recordedById: actor.userId ?? null,
        redeemedAt: now,
      },
    });
    await this.audit.log({
      action: 'MEMBERSHIP_BENEFIT_REDEEMED',
      entityType: 'MembershipBenefitRedemption',
      entityId: redemption.id,
      organizationId,
      userId: actor.userId,
      metadata: { benefitId, membershipId },
    });
    return redemption;
  }

  private canTouch(actor: MembershipActor, organizationId: string): boolean {
    if (actor.role === 'SUPER_ADMIN') {
      return !actor.scopedOrganizationId || actor.scopedOrganizationId === organizationId;
    }
    return Boolean(actor.scopedOrganizationId) && actor.scopedOrganizationId === organizationId;
  }
}
