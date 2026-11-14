import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { OrderStatus, Prisma, type PaymentMethod } from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../../common/audit.service';
import { paymentDeadline } from '../../common/payment-window';
import {
  ExternalChargeBlockedError,
  PaymentService,
  type ExternalCharge,
  type ExternalChargeHandler,
} from '../payment/payment.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  activeCount,
  addMonths,
  DAY_MS,
  isActiveAt,
  nextPeriod,
  periodMonths,
  type MembershipLite,
} from './membership-math';
import { RENEW_WINDOW_DAYS } from './memberships.service';

const BUYER_METHODS = ['CARD', 'SPEI', 'OXXO'] as const;
type BuyerMethod = (typeof BUYER_METHODS)[number];

type CheckoutRow = {
  id: string;
  publicId: string;
  organizationId: string;
  status: OrderStatus;
  amount: Prisma.Decimal;
  currency: ExternalCharge['currency'];
  paymentMethod: PaymentMethod;
};

function toCharge(row: CheckoutRow): ExternalCharge {
  return {
    id: row.id,
    publicId: row.publicId,
    organizationId: row.organizationId,
    status: row.status,
    amount: Number(row.amount),
    currency: row.currency,
    paymentMethod: row.paymentMethod,
  };
}

function liteOf(membership: {
  id: string;
  planId: string;
  expiresAt: Date;
  cancelledAt: Date | null;
  periods: Array<{ startsAt: Date; endsAt: Date; amount: Prisma.Decimal }>;
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
    })),
  };
}

/**
 * Compra de membresía por el comprador en la web.
 *
 * No cobra por su cuenta: crea un `MembershipCheckout` y pide el intent al
 * `PaymentService` (mismo Banorte, misma tabla de intents, mismo IPN y misma
 * confirmación demo que las órdenes). Al confirmarse el cobro, `activate` da de
 * alta o renueva la membresía con su periodo, en la misma transacción que crea
 * el `Payment`.
 */
@Injectable()
export class MembershipCheckoutService implements ExternalChargeHandler, OnModuleInit {
  readonly kind = 'membership';

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private payments: PaymentService
  ) {}

  onModuleInit() {
    this.payments.registerExternalCharge(this);
  }

  // ==================== LECTURAS PÚBLICAS Y DEL COMPRADOR ===================

  /**
   * Planes activos de la organización del sitio, sin sesión. Solo lo que el
   * comprador necesita para elegir: ni miembros, ni ingresos, ni ids internos
   * de cuentas. «Sin cupo» se dice como booleano, no con el conteo.
   */
  async publicPlans(orgSlug: string, now = new Date()) {
    const slug = typeof orgSlug === 'string' ? orgSlug.trim().toLowerCase().slice(0, 80) : '';
    if (!slug) throw new NotFoundException('Organización no encontrada');
    const org = await this.prisma.organization.findUnique({
      where: { slug },
      select: { id: true, name: true },
    });
    if (!org) throw new NotFoundException('Organización no encontrada');
    const plans = await this.prisma.membershipPlan.findMany({
      where: { organizationId: org.id, active: true },
      orderBy: [{ price: 'asc' }, { createdAt: 'asc' }],
      include: {
        benefits: {
          where: { active: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, type: true, description: true, redemptionLimit: true },
        },
      },
    });
    const limited = plans.filter((p) => p.maxMembers != null).map((p) => p.id);
    const taken = new Map<string, number>();
    if (limited.length) {
      const rows = await this.prisma.membership.findMany({
        where: { planId: { in: limited } },
        include: { periods: true },
      });
      for (const id of limited) {
        taken.set(id, activeCount(rows.filter((r) => r.planId === id).map(liteOf), now));
      }
    }
    return {
      organization: { name: org.name },
      plans: plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        slug: plan.slug,
        tier: plan.tier,
        description: plan.description,
        price: plan.price.toString(),
        currency: plan.currency,
        billingPeriod: plan.billingPeriod,
        soldOut: plan.maxMembers != null && (taken.get(plan.id) ?? 0) >= plan.maxMembers,
        benefits: plan.benefits,
      })),
    };
  }

  /** «Mi membresía»: plan, vigencia, periodos y beneficios, más lo que falta por pagar. */
  async mine(userId: string, now = new Date()) {
    const [memberships, pending] = await Promise.all([
      this.prisma.membership.findMany({
        where: { userId },
        orderBy: { expiresAt: 'desc' },
        include: {
          periods: { orderBy: { startsAt: 'asc' } },
          plan: {
            include: {
              organization: { select: { name: true } },
              benefits: {
                where: { active: true },
                orderBy: { createdAt: 'asc' },
                select: {
                  id: true,
                  name: true,
                  type: true,
                  description: true,
                  redemptionLimit: true,
                },
              },
            },
          },
          _count: { select: { redemptions: true } },
        },
      }),
      this.prisma.membershipCheckout.findMany({
        where: { userId, status: OrderStatus.PENDING, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
        include: { plan: { select: { name: true } } },
      }),
    ]);
    return {
      memberships: memberships.map((m) => {
        const active = m.status !== 'CANCELLED' && isActiveAt(liteOf(m), now);
        const current = m.periods.find(
          (p) => p.startsAt.getTime() <= now.getTime() && now.getTime() < p.endsAt.getTime()
        );
        return {
          id: m.id,
          status: m.status === 'CANCELLED' ? 'CANCELLED' : active ? 'ACTIVE' : 'EXPIRED',
          organizationName: m.plan.organization.name,
          plan: {
            id: m.plan.id,
            name: m.plan.name,
            tier: m.plan.tier,
            description: m.plan.description,
            price: m.plan.price.toString(),
            currency: m.plan.currency,
            billingPeriod: m.plan.billingPeriod,
          },
          startedAt: m.startedAt.toISOString(),
          expiresAt: m.expiresAt.toISOString(),
          currentPeriod: current
            ? { startsAt: current.startsAt.toISOString(), endsAt: current.endsAt.toISOString() }
            : null,
          canRenew:
            m.status !== 'CANCELLED' &&
            m.plan.active &&
            m.expiresAt.getTime() - now.getTime() <= RENEW_WINDOW_DAYS * DAY_MS,
          benefits: m.plan.benefits,
          redemptionsUsed: m._count.redemptions,
        };
      }),
      pending: pending.map((c) => ({
        publicId: c.publicId,
        planName: c.plan.name,
        amount: c.amount.toString(),
        currency: c.currency,
        paymentMethod: c.paymentMethod,
        expiresAt: c.expiresAt.toISOString(),
      })),
    };
  }

  /** Estado de una compra propia (la página de pago lo sondea). */
  async status(userId: string, publicId: string) {
    const row = await this.prisma.membershipCheckout.findUnique({
      where: { publicId: String(publicId ?? '').slice(0, 64) },
      include: { plan: { select: { name: true, billingPeriod: true } } },
    });
    // Mismo 404 para lo ajeno y lo inexistente.
    if (!row || row.userId !== userId) throw new NotFoundException('Compra no encontrada');
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { idempotencyKey: `${this.kind}:${row.id}` },
      select: { metadata: true, expiresAt: true },
    });
    const meta = (intent?.metadata ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      publicId: row.publicId,
      status: row.status,
      kind: row.kind,
      planName: row.plan.name,
      billingPeriod: row.plan.billingPeriod,
      amount: row.amount.toString(),
      currency: row.currency,
      paymentMethod: row.paymentMethod,
      expiresAt: row.expiresAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      payment: {
        reference: typeof meta.reference === 'string' ? meta.reference : null,
        clabe: typeof meta.clabe === 'string' ? meta.clabe : null,
        concept: typeof meta.concept === 'string' ? meta.concept : null,
        demo: meta.demo === true,
      },
    };
  }

  // ==================== INICIO DE COMPRA ====================================

  /**
   * Inicia la compra: valida el plan, el cupo y que no haya ya una membresía
   * vigente; crea el checkout y su intent por el camino de pago de las órdenes.
   * Un checkout pendiente del mismo plan se reutiliza (no se cobra dos veces).
   */
  async start(
    userId: string | undefined,
    body: { planId?: unknown; paymentMethod?: unknown },
    now = new Date()
  ) {
    if (!userId) throw new BadRequestException('Inicia sesión para comprar');
    const planId = typeof body?.planId === 'string' ? body.planId.trim().slice(0, 64) : '';
    if (!planId) throw new BadRequestException('planId es obligatorio');
    const rawMethod =
      typeof body?.paymentMethod === 'string' ? body.paymentMethod.trim().toUpperCase() : 'CARD';
    if (!(BUYER_METHODS as readonly string[]).includes(rawMethod)) {
      throw new BadRequestException('Método de pago inválido: CARD, SPEI u OXXO');
    }
    const method = rawMethod as BuyerMethod;

    const plan = await this.prisma.membershipPlan.findUnique({ where: { id: planId } });
    if (!plan || !plan.active) throw new NotFoundException('Plan no disponible');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    if (!user) throw new NotFoundException('Cuenta no encontrada');

    const existing = await this.prisma.membership.findUnique({
      where: { planId_userId: { planId, userId } },
      include: { periods: true },
    });
    if (existing?.status === 'CANCELLED') {
      throw new ConflictException(
        'Tu membresía de este plan está cancelada; contacta al organizador'
      );
    }
    if (existing && existing.expiresAt.getTime() - now.getTime() > RENEW_WINDOW_DAYS * DAY_MS) {
      throw new ConflictException(
        `Ya tienes este plan vigente hasta el ${existing.expiresAt.toISOString().slice(0, 10)}; ` +
          `la renovación se abre ${RENEW_WINDOW_DAYS} días antes de vencer`
      );
    }

    const pending = await this.prisma.membershipCheckout.findFirst({
      where: { userId, planId, status: OrderStatus.PENDING, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) {
      const intent = await this.payments.createExternalPaymentIntent(this, toCharge(pending), {
        email: pending.buyerEmail,
        name: pending.buyerName,
      });
      return this.startResponse(pending, plan.name, intent);
    }

    // Cupo: vigentes más compras ajenas en curso. Solo las altas ocupan lugar;
    // quien renueva ya lo tiene.
    const isActive = existing ? isActiveAt(liteOf(existing), now) : false;
    if (plan.maxMembers != null && !isActive) {
      const [rows, inFlight] = await Promise.all([
        this.prisma.membership.findMany({ where: { planId }, include: { periods: true } }),
        this.prisma.membershipCheckout.count({
          where: {
            planId,
            status: OrderStatus.PENDING,
            expiresAt: { gt: now },
            userId: { not: userId },
          },
        }),
      ]);
      if (activeCount(rows.map(liteOf), now) + inFlight >= plan.maxMembers) {
        throw new ConflictException('El plan no tiene cupo');
      }
    }

    const buyerName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email;
    const checkout = await this.prisma.membershipCheckout.create({
      data: {
        publicId: `MEM-${randomBytes(9).toString('base64url').toUpperCase()}`,
        organizationId: plan.organizationId,
        planId,
        userId,
        kind: existing ? 'RENEWAL' : 'NEW',
        amount: plan.price,
        currency: plan.currency,
        paymentMethod: method,
        buyerEmail: user.email,
        buyerName,
        expiresAt: paymentDeadline(method, now.getTime()),
      },
    });
    let intent;
    try {
      intent = await this.payments.createExternalPaymentIntent(this, toCharge(checkout), {
        email: user.email,
        name: buyerName,
      });
    } catch (error) {
      // Sin intent no hay nada que pagar: el checkout no debe ocupar cupo.
      await this.prisma.membershipCheckout.update({
        where: { id: checkout.id },
        data: { status: OrderStatus.FAILED },
      });
      throw error;
    }
    await this.audit.log({
      action: 'MEMBERSHIP_CHECKOUT_STARTED',
      entityType: 'MembershipCheckout',
      entityId: checkout.id,
      organizationId: plan.organizationId,
      userId,
      metadata: { planId, kind: checkout.kind, method, amount: plan.price.toString() },
    });
    return this.startResponse(checkout, plan.name, intent);
  }

  private startResponse(
    checkout: CheckoutRow & { kind: string; expiresAt: Date },
    planName: string,
    intent: {
      redirectUrl?: string;
      reference?: string;
      metadata?: unknown;
      expiresAt?: Date | null;
    }
  ) {
    const meta = (intent.metadata ?? {}) as Record<string, unknown>;
    return {
      id: checkout.id,
      publicId: checkout.publicId,
      status: checkout.status,
      kind: checkout.kind,
      planName,
      amount: checkout.amount.toString(),
      currency: checkout.currency,
      paymentMethod: checkout.paymentMethod,
      expiresAt: checkout.expiresAt.toISOString(),
      payment: {
        redirectUrl: intent.redirectUrl ?? null,
        reference: intent.reference ?? null,
        clabe: typeof meta.clabe === 'string' ? meta.clabe : null,
        concept: typeof meta.concept === 'string' ? meta.concept : null,
        demo: meta.demo === true,
      },
    };
  }

  // ==================== HANDLER DEL CAMINO DE PAGO ==========================

  async find(reference: string): Promise<ExternalCharge | null> {
    const ref = String(reference ?? '').trim();
    if (!ref) return null;
    const row =
      (await this.prisma.membershipCheckout.findUnique({ where: { id: ref } })) ??
      (ref.startsWith('MEM-')
        ? await this.prisma.membershipCheckout.findUnique({ where: { publicId: ref } })
        : null);
    return row ? toCharge(row) : null;
  }

  /** Update condicional por estado: el segundo IPN concurrente ve 0 filas. */
  async claim(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
    const res = await tx.membershipCheckout.updateMany({
      where: { id, status: { in: [OrderStatus.PENDING, OrderStatus.FAILED] } },
      data: { status: OrderStatus.COMPLETED, completedAt: new Date() },
    });
    return res.count === 1;
  }

  /**
   * Alta o renovación con su periodo. Sin cupo al momento del cobro (otro pagó
   * antes) se aborta: el cobro queda PENDING_REFUND, como una orden sin lugares.
   */
  async activate(
    tx: Prisma.TransactionClient,
    charge: ExternalCharge,
    paymentId: string,
    now = new Date()
  ): Promise<void> {
    const checkout = await tx.membershipCheckout.findUnique({
      where: { id: charge.id },
      include: { plan: true },
    });
    if (!checkout) throw new NotFoundException('Compra no encontrada');
    const plan = checkout.plan;
    const existing = await tx.membership.findUnique({
      where: { planId_userId: { planId: plan.id, userId: checkout.userId } },
      include: { periods: true },
    });
    if (existing?.status === 'CANCELLED') {
      throw new ExternalChargeBlockedError(
        'membership.cancelled',
        `La membresía de ${checkout.publicId} está cancelada. No se activa; el cobro debe devolverse.`,
        { checkoutPublicId: checkout.publicId }
      );
    }

    let membershipId: string;
    let periodId: string;
    let kind: 'NEW' | 'RENEWAL';
    let endsAt: Date;
    if (!existing) {
      if (plan.maxMembers != null) {
        const rows = await tx.membership.findMany({
          where: { planId: plan.id },
          include: { periods: true },
        });
        if (activeCount(rows.map(liteOf), now) >= plan.maxMembers) {
          throw new ExternalChargeBlockedError(
            'membership.plan_full',
            `El plan ${plan.name} se llenó antes de confirmarse ${checkout.publicId}. No se activa; el cobro debe devolverse.`,
            { checkoutPublicId: checkout.publicId, planId: plan.id, maxMembers: plan.maxMembers }
          );
        }
      }
      endsAt = addMonths(now, periodMonths(plan.billingPeriod));
      kind = 'NEW';
      const created = await tx.membership.create({
        data: {
          organizationId: plan.organizationId,
          planId: plan.id,
          userId: checkout.userId,
          startedAt: now,
          expiresAt: endsAt,
          periods: {
            create: {
              organizationId: plan.organizationId,
              kind,
              startsAt: now,
              endsAt,
              amount: checkout.amount,
            },
          },
        },
        include: { periods: true },
      });
      membershipId = created.id;
      periodId = created.periods[0].id;
    } else {
      const next = nextPeriod(existing.expiresAt, plan.billingPeriod, now);
      kind = next.kind;
      endsAt = next.endsAt;
      const period = await tx.membershipPeriod.create({
        data: {
          organizationId: plan.organizationId,
          membershipId: existing.id,
          kind: next.kind,
          startsAt: next.startsAt,
          endsAt: next.endsAt,
          amount: checkout.amount,
        },
      });
      await tx.membership.update({
        where: { id: existing.id },
        data: { expiresAt: next.endsAt },
      });
      membershipId = existing.id;
      periodId = period.id;
    }

    await tx.membershipCheckout.update({
      where: { id: checkout.id },
      data: { paymentId, membershipId, periodId, kind },
    });
    await tx.auditEvent.create({
      data: {
        action: kind === 'NEW' ? 'MEMBERSHIP_PURCHASED' : 'MEMBERSHIP_RENEWED',
        entityType: 'Membership',
        entityId: membershipId,
        organizationId: plan.organizationId,
        userId: checkout.userId,
        metadata: {
          checkoutPublicId: checkout.publicId,
          paymentId,
          kind,
          endsAt: endsAt.toISOString(),
          amount: checkout.amount.toString(),
        },
      },
    });
  }

  async markFailed(id: string): Promise<void> {
    await this.prisma.membershipCheckout.updateMany({
      where: { id, status: OrderStatus.PENDING },
      data: { status: OrderStatus.FAILED },
    });
  }

  async markPendingRefund(
    id: string,
    action: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const row = await this.prisma.membershipCheckout.update({
      where: { id },
      data: { status: OrderStatus.PENDING_REFUND },
      select: { id: true, organizationId: true },
    });
    await this.audit.log({
      action,
      entityType: 'MembershipCheckout',
      entityId: row.id,
      organizationId: row.organizationId,
      metadata,
    });
  }
}
