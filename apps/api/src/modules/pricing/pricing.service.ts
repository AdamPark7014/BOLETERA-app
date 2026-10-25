import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AuditService } from '../../common/audit.service';
import {
  mergeRateSettings,
  priceBreakdown,
  ratesFromSettings,
  type RatePatch,
} from '../../common/pricing-rates';
import { CampaignExecutionService } from '../campaign-execution/campaign-execution.service';
import { promotionDiscount } from '../campaign-execution/loyalty';
import { PrismaService } from '../prisma/prisma.service';

interface PricingContext {
  eventId: string;
  offerId: string;
  quantity: number;
  timestamp?: Date;
  customerSegment?: 'EARLY_BUYER' | 'REGULAR' | 'VVIP';
  promotionCode?: string;
  /** Cortesía: no meter la lealtad en el mismo lugar del código. */
  skipLoyalty?: boolean;
}

export interface PricingResult {
  basePrice: Decimal;
  dynamicMultiplier: number;
  adjustedPrice: Decimal;
  discount: Decimal;
  subtotal: Decimal;
  fees: Decimal;
  taxes: Decimal;
  total: Decimal;
  breakdown: {
    reason: string;
    appliedRules: string[];
  };
}

@Injectable()
export class PricingService {
  private logger = new Logger(PricingService.name);

  private readonly PRICE_RULES = {
    EARLY_BIRD: 0.85, // 15% discount
    REGULAR: 1.0,
    VVIP: 1.25, // 25% markup
    SURGE_MODERATE: 1.15, // 70-80% sold
    SURGE_HIGH: 1.3, // 80-90% sold
    SURGE_EXTREME: 1.5, // 90%+ sold
  };

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private campaigns: CampaignExecutionService,
  ) {}

  /** Tasas efectivas de la organización. Sin fila, las del entorno. */
  async readOrgRates(organizationId: string | null) {
    if (!organizationId) return ratesView(null);
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return ratesView(org.settings);
  }

  /**
   * Guarda en `Organization.settings` solo las tasas que llegan.
   * No toca plazos, PIN, comisiones ni el cargo de reventa.
   */
  async saveOrgRates(organizationId: string, body: RatePatch, actorId?: string) {
    const patch: RatePatch = {};
    if (body.serviceFeeRate !== undefined) {
      patch.serviceFeeRate = requireRate(body.serviceFeeRate, 'Cargo por servicio');
    }
    if (body.taxRate !== undefined) {
      patch.taxRate = requireRate(body.taxRate, 'IVA');
    }
    if (patch.serviceFeeRate === undefined && patch.taxRate === undefined) {
      throw new BadRequestException('No hay tasas que guardar');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    const settings = mergeRateSettings(org.settings, patch);
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { settings: settings as Prisma.InputJsonValue },
    });
    await this.audit.log({
      action: 'PRICING_RATES_UPDATED',
      entityType: 'Organization',
      entityId: organizationId,
      organizationId,
      userId: actorId,
      metadata: patch as Record<string, unknown>,
    });
    return ratesView(settings);
  }

  // ==================== CALCULATE PRICING ====================

  async calculatePrice(ctx: PricingContext): Promise<PricingResult> {
    const [event, offer] = await Promise.all([
      this.prisma.event.findUnique({
        where: { id: ctx.eventId },
        include: { organization: { select: { settings: true } } },
      }),
      this.prisma.offer.findUnique({ where: { id: ctx.offerId } }),
    ]);

    if (!event || !offer) {
      throw new BadRequestException('Event or offer not found');
    }

    const appliedRules: string[] = [];
    let dynamicMultiplier = 1.0;
    let basePrice = Number(offer.basePrice);

    // 1. Calculate occupancy rate
    const soldCount = await this.prisma.ticket.count({
      where: {
        eventId: ctx.eventId,
        offerId: ctx.offerId,
        status: { in: ['SOLD', 'USED'] },
      },
    });

    const occupancyRate = soldCount / offer.totalQuantity;
    appliedRules.push(`Occupancy: ${(occupancyRate * 100).toFixed(1)}%`);

    // 2. Apply dynamic pricing based on occupancy (if enabled)
    if (event.enableDynamic) {
      const surge = this.calculateSurgePricing(occupancyRate);
      if (surge.multiplier !== 1.0) {
        dynamicMultiplier *= surge.multiplier;
        appliedRules.push(`Surge pricing: ${surge.reason}`);
      }
    }

    // 3. Precio por cercanía de la fecha.
    //
    // Va DENTRO de `enableDynamic`, igual que el surge. Antes se aplicaba
    // siempre: un evento con el precio dinámico explícitamente desactivado veía
    // su precio moverse con el calendario, en silencio y sin que el promotor lo
    // hubiera pedido. Peor: rompía la promesa del catálogo, porque el «desde»
    // anunciado dejaba de ser el que se cobraba en el checkout — que es
    // exactamente la práctica que la ley obliga a evitar.
    if (event.enableDynamic) {
      const daysUntilEvent =
        (event.startsAt.getTime() - (ctx.timestamp?.getTime() ?? Date.now())) /
        (1000 * 60 * 60 * 24);
      const timeMultiplier = this.calculateTimeMultiplier(daysUntilEvent);
      if (timeMultiplier !== 1.0) {
        dynamicMultiplier *= timeMultiplier;
        appliedRules.push(`Time-based pricing: ${daysUntilEvent.toFixed(0)} days until event`);
      }
    }

    // 4. Apply customer segment pricing
    const segmentKey =
      ctx.customerSegment === 'EARLY_BUYER' ? 'EARLY_BIRD' : (ctx.customerSegment || 'REGULAR');
    const segmentMultiplier =
      this.PRICE_RULES[segmentKey as keyof typeof this.PRICE_RULES] ?? this.PRICE_RULES.REGULAR;
    if (segmentMultiplier !== 1.0) {
      dynamicMultiplier *= segmentMultiplier;
      appliedRules.push(`Customer segment: ${ctx.customerSegment || 'REGULAR'}`);
    }

    // 5. Apply promotion/discount. La lealtad entra aquí, con el mismo código.
    let promotionCode = ctx.promotionCode?.trim() || '';
    if (!promotionCode && !ctx.skipLoyalty) {
      promotionCode = (await this.campaigns.loyaltyChargeCode(ctx.eventId)) ?? '';
    }
    let discountAmount = 0;
    const gross = basePrice * dynamicMultiplier * ctx.quantity;
    if (promotionCode) {
      const promotion = await this.prisma.promotion.findUnique({
        where: { code: promotionCode },
      });

      if (promotion && this.isPromotionValid(promotion)) {
        discountAmount = this.calculateDiscount(promotion, gross);
        appliedRules.push(`Promotion ${promotionCode}: -${discountAmount.toFixed(2)}`);
      }
    }

    // 6. Calculate final prices
    const adjustedPrice = new Decimal(basePrice * dynamicMultiplier);
    const subtotal = new Decimal(gross - discountAmount);
    // Tasa guardada en la organización; si no hay, la del entorno.
    // La fórmula no cambia: base + cargo + IVA. Es la misma del precio anunciado.
    const rates = ratesFromSettings(event.organization.settings);
    const fees = subtotal.mul(rates.serviceFeeRate);
    const taxes = subtotal.mul(rates.taxRate);
    const total = subtotal.plus(fees).plus(taxes);

    this.logger.log(
      `Price calculated for event ${ctx.eventId}: ${total.toFixed(2)} (multiplier: ${dynamicMultiplier.toFixed(2)})`,
    );

    return {
      basePrice: new Decimal(basePrice),
      dynamicMultiplier,
      adjustedPrice,
      discount: new Decimal(discountAmount),
      subtotal,
      fees,
      taxes,
      total,
      breakdown: {
        reason: 'Dynamic pricing applied',
        appliedRules,
      },
    };
  }

  // ==================== SURGE PRICING CALCULATION ====================

  private calculateSurgePricing(occupancyRate: number) {
    if (occupancyRate >= 0.9) {
      return { multiplier: this.PRICE_RULES.SURGE_EXTREME, reason: 'Extreme demand (90%+ sold)' };
    }
    if (occupancyRate >= 0.8) {
      return { multiplier: this.PRICE_RULES.SURGE_HIGH, reason: 'High demand (80-90% sold)' };
    }
    if (occupancyRate >= 0.7) {
      return { multiplier: this.PRICE_RULES.SURGE_MODERATE, reason: 'Moderate demand (70-80% sold)' };
    }
    return { multiplier: 1.0, reason: 'No surge' };
  }

  // ==================== TIME-BASED PRICING ====================

  private calculateTimeMultiplier(daysUntilEvent: number) {
    if (daysUntilEvent < 0) return 1.0; // Event passed
    if (daysUntilEvent <= 1) return 1.4; // Last minute
    if (daysUntilEvent <= 3) return 1.25; // Last few days
    if (daysUntilEvent <= 7) return 1.1; // Week before
    if (daysUntilEvent <= 30) return 1.05; // Month before
    if (daysUntilEvent <= 90) return 0.95; // 90 days: small discount
    return 0.9; // Early bird: 10% discount
  }

  // ==================== DISCOUNT CALCULATION ====================

  private calculateDiscount(promotion: { type: string; value: unknown; maxDiscount?: unknown }, subtotal: number): number {
    return promotionDiscount(
      promotion.type,
      Number(promotion.value),
      subtotal,
      promotion.maxDiscount != null ? Number(promotion.maxDiscount) : null,
    );
  }

  // ==================== PROMOTION VALIDATION ====================

  private isPromotionValid(promotion: any): boolean {
    const now = new Date();
    if (promotion.startDate > now || promotion.endDate < now) return false;
    if (promotion.usageLimit && promotion.usageCount >= promotion.usageLimit) return false;
    return true;
  }

  // ==================== UPDATE DYNAMIC PRICES ====================

  async updateDynamicPrices(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { offers: true },
    });

    if (!event) throw new BadRequestException('Event not found');

    const now = new Date();

    for (const offer of event.offers) {
      const soldCount = await this.prisma.ticket.count({
        where: {
          eventId,
          offerId: offer.id,
          status: { in: ['SOLD', 'USED'] },
        },
      });

      const occupancyRate = soldCount / offer.totalQuantity;
      const surge = this.calculateSurgePricing(occupancyRate);

      if (surge.multiplier !== 1.0) {
        const adjustedPrice = Number(offer.basePrice) * surge.multiplier;

        await this.prisma.dynamicPrice.create({
          data: {
            eventId,
            offerId: offer.id,
            adjustedPrice: new Decimal(adjustedPrice),
            priceMultiplier: surge.multiplier,
            reason: `surge_pricing_${occupancyRate.toFixed(2)}`,
            activeFrom: now,
            activeTo: new Date(now.getTime() + 60 * 60 * 1000), // 1 hour
          },
        });

        this.logger.log(`Updated dynamic price for offer ${offer.id}: ${adjustedPrice.toFixed(2)}`);
      }
    }
  }

  // ==================== GET PRICE HISTORY ====================

  async getPriceHistory(offerId: string, limit = 20) {
    return await this.prisma.dynamicPrice.findMany({
      where: { offerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // ==================== ESTIMATE REVENUE ====================

  async estimateEventRevenue(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { offers: true },
    });

    if (!event) throw new BadRequestException('Event not found');

    let totalRevenue = 0;
    let soldTickets = 0;

    for (const offer of event.offers) {
      const sold = await this.prisma.ticket.count({
        where: {
          eventId,
          offerId: offer.id,
          status: { in: ['SOLD', 'USED'] },
        },
      });

      const revenue = sold * Number(offer.basePrice);
      totalRevenue += revenue;
      soldTickets += sold;
    }

    const commission = event.organizationId
      ? await this.calculateCommission(event.organizationId, totalRevenue)
      : 0;

    return {
      eventId,
      title: event.title,
      totalCapacity: event.totalCapacity,
      soldTickets,
      occupancyPercent: ((soldTickets / event.totalCapacity) * 100).toFixed(2),
      grossRevenue: totalRevenue,
      commission,
      netRevenue: totalRevenue - commission,
      currency: event.currency,
    };
  }

  // ==================== CALCULATE COMMISSION ====================

  private async calculateCommission(organizationId: string, revenue: number): Promise<number> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!org) return 0;
    return revenue * org.commissionRate;
  }
}

function ratesView(settings: unknown) {
  const rates = ratesFromSettings(settings);
  return {
    serviceFeeRate: rates.serviceFeeRate,
    taxRate: rates.taxRate,
    serviceFeeSaved: rates.serviceFeeSaved,
    taxSaved: rates.taxSaved,
    example: priceBreakdown(1000, rates),
  };
}

function requireRate(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new BadRequestException(`${label} tiene que ser una tasa entre 0 y 1`);
  }
  return Number(value.toFixed(4));
}


