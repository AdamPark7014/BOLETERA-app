import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgAccessGuard, type OrgScopedRequest } from '../auth/org-access.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { type RatePatch } from '../../common/pricing-rates';
import { PricingService } from './pricing.service';

type ScopedRequest = OrgScopedRequest & { user?: { role?: string } };

function requireScope(req: ScopedRequest): string | null {
  const scoped = req.scopedOrganizationId ?? null;
  if (scoped) return scoped;
  if (req.user?.role === 'SUPER_ADMIN') return null;
  throw new BadRequestException('organizationId requerido');
}

@ApiTags('Pricing')
@Controller('pricing')
export class PricingController {
  constructor(private pricingService: PricingService) {}

  /** Tasas de la organización. Vacío, las del entorno. No cambia la fórmula. */
  @Get('rates')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tasas efectivas de cargo e IVA' })
  readRates(@Request() req: ScopedRequest) {
    return this.pricingService.readOrgRates(requireScope(req));
  }

  @Patch('rates')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Guardar tasa de cargo e IVA' })
  saveRates(
    @Request() req: ScopedRequest,
    @Body() body: RatePatch,
    @CurrentUser() user: { sub?: string; id?: string },
  ) {
    const organizationId = requireScope(req);
    if (!organizationId) throw new BadRequestException('organizationId requerido');
    return this.pricingService.saveOrgRates(organizationId, body ?? {}, user?.sub || user?.id);
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


