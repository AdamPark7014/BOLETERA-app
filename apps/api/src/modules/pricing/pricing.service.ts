import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SERVICE_FEE_RATE, TAX_RATE } from '../../common/pricing-rates';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

interface PricingContext {
  eventId: string;
  offerId: string;
  quantity: number;
  timestamp?: Date;
  customerSegment?: 'EARLY_BUYER' | 'REGULAR' | 'VVIP';
  promotionCode?: string;
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

  constructor(private prisma: PrismaService) {}

  // ==================== CALCULATE PRICING ====================

  async calculatePrice(ctx: PricingContext): Promise<PricingResult> {
    const [event, offer] = await Promise.all([
      this.prisma.event.findUnique({ where: { id: ctx.eventId } }),
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

    // 5. Apply promotion/discount
    let discountAmount = 0;
    if (ctx.promotionCode) {
      const promotion = await this.prisma.promotion.findUnique({
        where: { code: ctx.promotionCode },
      });

      if (promotion && this.isPromotionValid(promotion)) {
        const discount = this.calculateDiscount(promotion, basePrice * dynamicMultiplier * ctx.quantity);
        discountAmount = discount;
        appliedRules.push(`Promotion ${ctx.promotionCode}: -${discount.toFixed(2)}`);
      }
    }

    // 6. Calculate final prices
    const adjustedPrice = new Decimal(basePrice * dynamicMultiplier);
    const subtotal = new Decimal(basePrice * dynamicMultiplier * ctx.quantity - discountAmount);
    // Mismas tarifas que alimentan el precio «desde» del catálogo: lo anunciado
    // y lo cobrado no pueden salir de dos sitios distintos.
    const fees = subtotal.mul(SERVICE_FEE_RATE);
    const taxes = subtotal.mul(TAX_RATE);
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

  private calculateDiscount(promotion: any, subtotal: number): number {
    if (promotion.type === 'PERCENTAGE') {
      const discount = subtotal * (Number(promotion.value) / 100);
      const maxDiscount = promotion.maxDiscount ? Number(promotion.maxDiscount) : Infinity;
      return Math.min(discount, maxDiscount);
    }

    if (promotion.type === 'FIXED_AMOUNT') {
      return Math.min(Number(promotion.value), subtotal);
    }

    if (promotion.type === 'BOGO') {
      return subtotal * 0.5; // Buy one, get one 50% off
    }

    return 0;
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


