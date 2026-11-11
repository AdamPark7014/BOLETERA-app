import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  bundleSummary,
  eventSignals,
  recommendOffer,
  type OfferInput,
  type OfferRecommendation,
} from './recommendation-engine';

/** Una recomendación encolada caduca a las 24 h: las señales ya cambiaron. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/** Prefijo de `DynamicPrice.reason` que el panel reconoce como «Aplicada». */
export const APPLIED_REASON_PREFIX = 'applied_recommendation|';

/** Quién actúa y sobre qué organización (null solo para SUPER_ADMIN sin tenant). */
export type Actor = { userId?: string; role?: string; scopedOrganizationId: string | null };

type Tx = Prisma.TransactionClient;

function canTouch(actor: Actor, organizationId: string): boolean {
  if (actor.role === 'SUPER_ADMIN') {
    return !actor.scopedOrganizationId || actor.scopedOrganizationId === organizationId;
  }
  return Boolean(actor.scopedOrganizationId) && actor.scopedOrganizationId === organizationId;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

@Injectable()
export class PricingRecommendationsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService
  ) {}

  /** Paquete de recomendaciones calculado al vuelo. No escribe nada. */
  async buildBundle(eventId: string, now = new Date()) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { offers: { orderBy: { createdAt: 'asc' } } },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    const [soldRows, firstApplied] = await Promise.all([
      this.prisma.ticket.groupBy({
        by: ['offerId'],
        where: { eventId, status: { in: ['SOLD', 'USED'] } },
        _count: { _all: true },
      }),
      this.prisma.pricingRecommendation.findMany({
        where: { eventId, status: 'APPLIED' },
        orderBy: { appliedAt: 'asc' },
        select: { offerId: true, fromPrice: true, appliedAt: true },
      }),
    ]);
    const sold = new Map(soldRows.map((row) => [row.offerId, row._count._all]));
    const reference = new Map<string, number>();
    const lastApplied = new Map<string, Date>();
    for (const row of firstApplied) {
      if (!reference.has(row.offerId)) reference.set(row.offerId, Number(row.fromPrice));
      if (row.appliedAt) lastApplied.set(row.offerId, row.appliedAt);
    }

    const inputs: OfferInput[] = event.offers.map((offer) => {
      const current = Number(offer.basePrice);
      const saleEnd = new Date(Math.min(offer.endDate.getTime(), event.startsAt.getTime()));
      return {
        offerId: offer.id,
        name: offer.name,
        zone: offer.zone,
        currentPrice: current,
        referencePrice: reference.get(offer.id) ?? current,
        totalQuantity: offer.totalQuantity,
        sold: sold.get(offer.id) ?? 0,
        saleStart: offer.startDate,
        saleEnd,
        isAvailable: offer.isAvailable,
        lastAppliedAt: lastApplied.get(offer.id) ?? null,
      };
    });
    const recommendations = inputs.map((input) =>
      recommendOffer(input, now, { enableDynamic: event.enableDynamic })
    );

    return {
      eventId: event.id,
      organizationId: event.organizationId,
      title: event.title,
      generatedAt: now.toISOString(),
      enableDynamic: event.enableDynamic,
      signals: eventSignals(inputs, event.startsAt, now),
      recommendations,
      summary: bundleSummary(recommendations),
    };
  }

  /** Cola de aprobación del evento (incluye las caducadas para que se vean). */
  async listPending(eventId: string) {
    const rows = await this.prisma.pricingRecommendation.findMany({
      where: { eventId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        eventId: row.eventId,
        offerId: row.offerId,
        adjustedPrice: Number(row.proposedPrice),
        priceMultiplier: row.multiplier,
        createdAt: row.createdAt.toISOString(),
        status: 'pending' as const,
        reason: row.explanation,
        payload: {
          v: 1 as const,
          status: 'pending' as const,
          explanation: row.explanation,
          factors: Array.isArray(payload.factors) ? payload.factors : [],
          direction: row.direction,
          deltaPercent: row.deltaPercent,
          requiresApproval: true,
          guardrail: payload.guardrail ?? null,
          basePrice:
            typeof payload.basePrice === 'number' ? payload.basePrice : Number(row.fromPrice),
          currentPrice: Number(row.fromPrice),
        },
      };
    });
  }

  /**
   * Aplica o encola las ofertas pedidas, recalculando con las cifras de ahora.
   * `confirmApproval` = la persona firma también las que exigen aprobación.
   */
  async apply(
    eventId: string,
    offerIds: readonly string[],
    confirmApproval: boolean,
    actor: Actor
  ) {
    if (!Array.isArray(offerIds) || offerIds.length === 0) {
      throw new BadRequestException('offerIds requerido');
    }
    const bundle = await this.buildBundle(eventId);
    const byOffer = new Map(bundle.recommendations.map((item) => [item.offerId, item]));
    const applied: string[] = [];
    const skipped: string[] = [];
    const pendingCreated: string[] = [];

    for (const offerId of new Set(offerIds)) {
      const item = byOffer.get(offerId);
      if (!item || item.direction === 'hold') {
        skipped.push(offerId);
        continue;
      }
      if (item.requiresApproval && !confirmApproval) {
        const id = await this.enqueue(bundle.organizationId, eventId, item, actor);
        pendingCreated.push(id);
        continue;
      }
      await this.applyNow(bundle.organizationId, eventId, item, actor, null);
      applied.push(offerId);
    }
    return { applied, skipped, pendingCreated };
  }

  /**
   * Genera, aplica solas las seguras (`autoApplicable`) y encola el resto.
   * Las de «mantener» no escriben nada.
   */
  async generate(eventId: string, actor: Actor) {
    const bundle = await this.buildBundle(eventId);
    let applied = 0;
    let pendingApproval = 0;
    let held = 0;
    for (const item of bundle.recommendations) {
      if (item.direction === 'hold') {
        held += 1;
      } else if (item.autoApplicable) {
        await this.applyNow(bundle.organizationId, eventId, item, actor, null);
        applied += 1;
      } else {
        await this.enqueue(bundle.organizationId, eventId, item, actor);
        pendingApproval += 1;
      }
    }
    return {
      message: `Aplicadas ${applied} · pendientes ${pendingApproval} · sin cambio ${held}`,
      applied,
      pendingApproval,
      held,
      summary: bundle.summary,
      signals: bundle.signals,
    };
  }

  async approve(
    recommendationId: string,
    note: string | undefined,
    actor: Actor,
    now = new Date()
  ) {
    const row = await this.loadPending(recommendationId, actor);
    if (now.getTime() - row.createdAt.getTime() > PENDING_TTL_MS) {
      throw new BadRequestException('La recomendación caducó (más de 24 h). Genera una nueva.');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.writePrice(tx, {
        offerId: row.offerId,
        eventId: row.eventId,
        fromPrice: Number(row.fromPrice),
        toPrice: Number(row.proposedPrice),
        multiplier: row.multiplier,
        explanation: row.explanation,
        now,
      });
      await tx.pricingRecommendation.update({
        where: { id: row.id },
        data: {
          status: 'APPLIED',
          reviewedById: actor.userId ?? null,
          reviewedAt: now,
          reviewNote: note?.trim() || null,
          appliedAt: now,
        },
      });
    });
    await this.audit.log({
      action: 'PRICING_RECOMMENDATION_APPROVED',
      entityType: 'PricingRecommendation',
      entityId: row.id,
      organizationId: row.organizationId,
      userId: actor.userId,
      metadata: {
        offerId: row.offerId,
        fromPrice: Number(row.fromPrice),
        toPrice: Number(row.proposedPrice),
        note: note?.trim() || null,
      },
    });
    return { id: row.id, status: 'approved' as const };
  }

  async reject(
    recommendationId: string,
    reason: string | undefined,
    actor: Actor,
    now = new Date()
  ) {
    const row = await this.loadPending(recommendationId, actor);
    await this.prisma.pricingRecommendation.update({
      where: { id: row.id },
      data: {
        status: 'REJECTED',
        reviewedById: actor.userId ?? null,
        reviewedAt: now,
        reviewNote: reason?.trim() || null,
      },
    });
    await this.audit.log({
      action: 'PRICING_RECOMMENDATION_REJECTED',
      entityType: 'PricingRecommendation',
      entityId: row.id,
      organizationId: row.organizationId,
      userId: actor.userId,
      metadata: { offerId: row.offerId, reason: reason?.trim() || null },
    });
    return { id: row.id, status: 'rejected' as const };
  }

  /** Historial de una oferta, con guarda de organización. */
  async history(offerId: string, limit: number, actor: Actor) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      select: { event: { select: { organizationId: true } } },
    });
    if (!offer) throw new NotFoundException('Oferta no encontrada');
    if (!canTouch(actor, offer.event.organizationId)) {
      throw new ForbiddenException('Organization access denied');
    }
    const take = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 20;
    return this.prisma.dynamicPrice.findMany({
      where: { offerId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  // ---------------------------------------------------------------------------

  private async loadPending(recommendationId: string, actor: Actor) {
    const row = await this.prisma.pricingRecommendation.findUnique({
      where: { id: recommendationId },
    });
    // Ajena o inexistente: misma respuesta, para no confirmar ids de otra organización.
    if (!row || !canTouch(actor, row.organizationId)) {
      throw new NotFoundException('Recomendación no encontrada');
    }
    if (row.status !== 'PENDING') {
      throw new ConflictException('La recomendación ya fue revisada');
    }
    return row;
  }

  /** Encola una recomendación; la pendiente anterior de la misma oferta queda reemplazada. */
  private async enqueue(
    organizationId: string,
    eventId: string,
    item: OfferRecommendation,
    actor: Actor
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      await tx.pricingRecommendation.updateMany({
        where: { offerId: item.offerId, status: 'PENDING' },
        data: { status: 'SUPERSEDED' },
      });
      const created = await tx.pricingRecommendation.create({
        data: this.rowData(organizationId, eventId, item, actor, 'PENDING'),
        select: { id: true },
      });
      return created.id;
    });
  }

  private async applyNow(
    organizationId: string,
    eventId: string,
    item: OfferRecommendation,
    actor: Actor,
    note: string | null
  ) {
    const now = new Date();
    const id = await this.prisma.$transaction(async (tx) => {
      await this.writePrice(tx, {
        offerId: item.offerId,
        eventId,
        fromPrice: item.currentPrice,
        toPrice: item.recommendedPrice,
        multiplier: item.recommendedMultiplier,
        explanation: item.explanation,
        now,
      });
      await tx.pricingRecommendation.updateMany({
        where: { offerId: item.offerId, status: 'PENDING' },
        data: { status: 'SUPERSEDED' },
      });
      const created = await tx.pricingRecommendation.create({
        data: {
          ...this.rowData(organizationId, eventId, item, actor, 'APPLIED'),
          reviewedById: actor.userId ?? null,
          reviewedAt: now,
          reviewNote: note,
          appliedAt: now,
        },
        select: { id: true },
      });
      return created.id;
    });
    await this.audit.log({
      action: 'PRICING_RECOMMENDATION_APPLIED',
      entityType: 'PricingRecommendation',
      entityId: id,
      organizationId,
      userId: actor.userId,
      metadata: {
        offerId: item.offerId,
        fromPrice: item.currentPrice,
        toPrice: item.recommendedPrice,
        auto: item.autoApplicable,
      },
    });
  }

  /**
   * Escribe el precio real de la oferta solo si sigue siendo el que se midió
   * (evita pisar un cambio hecho entre el cálculo y la aprobación) y deja la
   * fila de historial en `DynamicPrice`.
   */
  private async writePrice(
    tx: Tx,
    input: {
      offerId: string;
      eventId: string;
      fromPrice: number;
      toPrice: number;
      multiplier: number;
      explanation: string;
      now: Date;
    }
  ) {
    const updated = await tx.offer.updateMany({
      where: { id: input.offerId, basePrice: new Prisma.Decimal(input.fromPrice) },
      data: { basePrice: new Prisma.Decimal(input.toPrice) },
    });
    if (updated.count !== 1) {
      throw new ConflictException(
        'El precio de la oferta cambió desde que se calculó la recomendación. Vuelve a generarla.'
      );
    }
    const event = await tx.event.findUnique({
      where: { id: input.eventId },
      select: { startsAt: true, endsAt: true },
    });
    await tx.dynamicPrice.create({
      data: {
        eventId: input.eventId,
        offerId: input.offerId,
        adjustedPrice: new Prisma.Decimal(input.toPrice),
        priceMultiplier: input.multiplier,
        reason:
          `${APPLIED_REASON_PREFIX}De ${money(input.fromPrice)} a ${money(input.toPrice)}. ${input.explanation}`.slice(
            0,
            500
          ),
        activeFrom: input.now,
        activeTo: event?.endsAt ?? event?.startsAt ?? input.now,
      },
    });
  }

  private rowData(
    organizationId: string,
    eventId: string,
    item: OfferRecommendation,
    actor: Actor,
    status: 'PENDING' | 'APPLIED'
  ): Prisma.PricingRecommendationUncheckedCreateInput {
    return {
      organizationId,
      eventId,
      offerId: item.offerId,
      status,
      fromPrice: new Prisma.Decimal(item.currentPrice),
      proposedPrice: new Prisma.Decimal(item.recommendedPrice),
      multiplier: item.recommendedMultiplier,
      direction: item.direction,
      deltaPercent: item.deltaPercent,
      explanation: item.explanation,
      payload: {
        factors: item.factors,
        guardrail: item.guardrail,
        basePrice: item.basePrice,
        confidence: item.confidence,
      } as unknown as Prisma.InputJsonValue,
      createdById: actor.userId ?? null,
    };
  }
}
