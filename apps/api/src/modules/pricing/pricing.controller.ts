import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { priceBreakdown, SERVICE_FEE_RATE, TAX_RATE } from '../../common/pricing-rates';
import { PricingService } from './pricing.service';

@ApiTags('Pricing')
@Controller('pricing')
export class PricingController {
  constructor(private pricingService: PricingService) {}

  /** Tasas efectivas del entorno. No escribe y no cambia el cálculo all-in. */
  @Get('rates')
  @ApiOperation({ summary: 'Tasas efectivas de cargo e IVA' })
  rates() {
    return {
      serviceFeeRate: SERVICE_FEE_RATE,
      taxRate: TAX_RATE,
      example: priceBreakdown(1000),
    };
  }

  // ==================== CALCULATE PRICE ====================

  @Post('calculate')
  @ApiOperation({ summary: 'Calculate ticket price with all factors' })
  async calculatePrice(
    @Body()
    dto: {
      eventId: string;
      offerId: string;
      quantity: number;
      customerSegment?: 'EARLY_BUYER' | 'REGULAR' | 'VVIP';
      promotionCode?: string;
    },
  ) {
    return await this.pricingService.calculatePrice({
      ...dto,
      timestamp: new Date(),
    });
  }

  @Post('calculate-cart')
  @ApiOperation({ summary: 'Calculate cart total across multiple offers' })
  async calculateCart(
    @Body()
    dto: {
      eventId: string;
      items: { offerId: string; quantity: number }[];
      promotionCode?: string;
      customerSegment?: 'EARLY_BUYER' | 'REGULAR' | 'VVIP';
    },
  ) {
    if (!dto.items?.length) {
      return { subtotal: '0', fees: '0', taxes: '0', total: '0', discount: '0', lines: [] };
    }
    const lines = [];
    let subtotal = 0;
    let fees = 0;
    let taxes = 0;
    let total = 0;
    let discount = 0;
    for (const item of dto.items) {
      if (!item.offerId || !item.quantity) continue;
      const line = await this.pricingService.calculatePrice({
        eventId: dto.eventId,
        offerId: item.offerId,
        quantity: item.quantity,
        promotionCode: dto.promotionCode,
        customerSegment: dto.customerSegment,
        timestamp: new Date(),
      });
      lines.push({ offerId: item.offerId, quantity: item.quantity, ...line });
      subtotal += Number(line.subtotal);
      fees += Number(line.fees);
      taxes += Number(line.taxes);
      total += Number(line.total);
      discount += Number(line.discount);
    }
    return {
      subtotal: subtotal.toFixed(2),
      fees: fees.toFixed(2),
      taxes: taxes.toFixed(2),
      total: total.toFixed(2),
      discount: discount.toFixed(2),
      lines,
    };
  }

  // ==================== UPDATE DYNAMIC PRICES ====================

  @Post('events/:eventId/update-dynamic')
  @ApiOperation({ summary: 'Update dynamic prices for event' })
  async updateDynamicPrices(@Param('eventId') eventId: string) {
    await this.pricingService.updateDynamicPrices(eventId);
    return { message: 'Dynamic prices updated' };
  }

  // ==================== PRICE HISTORY ====================

  @Get('offers/:offerId/history')
  @ApiOperation({ summary: 'Get price history for offer' })
  async getPriceHistory(
    @Param('offerId') offerId: string,
    @Query('limit') limit?: number,
  ) {
    return await this.pricingService.getPriceHistory(offerId, limit);
  }

  // ==================== REVENUE ESTIMATION ====================

  @Get('events/:eventId/revenue-estimate')
  @ApiOperation({ summary: 'Estimate event revenue' })
  async estimateRevenue(@Param('eventId') eventId: string) {
    return await this.pricingService.estimateEventRevenue(eventId);
  }
}


