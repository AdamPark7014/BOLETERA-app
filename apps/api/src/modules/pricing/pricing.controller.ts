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
import { EventOrgAccessGuard } from '../auth/event-org-access.guard';
import { OrgAccessGuard, type OrgScopedRequest } from '../auth/org-access.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { type RatePatch } from '../../common/pricing-rates';
import { PricingRecommendationsService, type Actor } from './pricing-recommendations.service';
import { PricingService } from './pricing.service';

type ScopedRequest = OrgScopedRequest & { user?: { role?: string; sub?: string; id?: string } };

const READ_ROLES = ['PROMOTER', 'VENUE_MANAGER', 'ADMIN', 'SUPER_ADMIN'] as const;
const WRITE_ROLES = ['PROMOTER', 'ADMIN', 'SUPER_ADMIN'] as const;

function actorOf(req: ScopedRequest): Actor {
  return {
    userId: req.user?.sub || req.user?.id,
    role: req.user?.role,
    scopedOrganizationId: req.scopedOrganizationId ?? null,
  };
}

function requireScope(req: ScopedRequest): string | null {
  const scoped = req.scopedOrganizationId ?? null;
  if (scoped) return scoped;
  if (req.user?.role === 'SUPER_ADMIN') return null;
  throw new BadRequestException('organizationId requerido');
}

@ApiTags('Pricing')
@Controller('pricing')
export class PricingController {
  constructor(
    private pricingService: PricingService,
    private recommendationsService: PricingRecommendationsService
  ) {}

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
    @CurrentUser() user: { sub?: string; id?: string }
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
    }
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
    }
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

  // ==================== RECOMENDACIONES ====================
  //
  // Motor determinista en `recommendation-engine.ts` (reglas documentadas ahí).
  // Rutas por evento: el tenant sale del evento (EventOrgAccessGuard).

  @Get('events/:eventId/recommendations')
  @UseGuards(JwtAuthGuard, RolesGuard, EventOrgAccessGuard)
  @Roles(...READ_ROLES)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Recomendaciones de precio por oferta (no escribe)' })
  recommendations(@Param('eventId') eventId: string) {
    return this.recommendationsService.buildBundle(eventId);
  }

  @Post('events/:eventId/recommendations/preview')
  @UseGuards(JwtAuthGuard, RolesGuard, EventOrgAccessGuard)
  @Roles(...READ_ROLES)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Vista previa del paquete de recomendaciones (no escribe)' })
  previewRecommendations(@Param('eventId') eventId: string) {
    return this.recommendationsService.buildBundle(eventId);
  }

  @Get('events/:eventId/recommendations/pending')
  @UseGuards(JwtAuthGuard, RolesGuard, EventOrgAccessGuard)
  @Roles(...READ_ROLES)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cola de aprobación de precios del evento' })
  pendingRecommendations(@Param('eventId') eventId: string) {
    return this.recommendationsService.listPending(eventId);
  }

  @Post('events/:eventId/recommendations/apply')
  @UseGuards(JwtAuthGuard, RolesGuard, EventOrgAccessGuard)
  @Roles(...WRITE_ROLES)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Aplicar o encolar recomendaciones de ofertas' })
  applyRecommendations(
    @Param('eventId') eventId: string,
    @Body() body: { offerIds?: string[]; confirmApproval?: boolean },
    @Request() req: ScopedRequest
  ) {
    return this.recommendationsService.apply(
      eventId,
      body?.offerIds ?? [],
      body?.confirmApproval === true,
      actorOf(req)
    );
  }

  /** Genera, aplica solas las seguras y encola el resto. */
  @Post('events/:eventId/update-dynamic')
  @UseGuards(JwtAuthGuard, RolesGuard, EventOrgAccessGuard)
  @Roles(...WRITE_ROLES)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generar recomendaciones: aplica las seguras y encola el resto' })
  updateDynamicPrices(@Param('eventId') eventId: string, @Request() req: ScopedRequest) {
    return this.recommendationsService.generate(eventId, actorOf(req));
  }

  @Post('recommendations/:id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles(...WRITE_ROLES)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Aprobar y aplicar una recomendación encolada' })
  approveRecommendation(
    @Param('id') id: string,
    @Body() body: { note?: string },
    @Request() req: ScopedRequest
  ) {
    return this.recommendationsService.approve(id, body?.note, actorOf(req));
  }

  @Post('recommendations/:id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles(...WRITE_ROLES)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Rechazar una recomendación encolada' })
  rejectRecommendation(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Request() req: ScopedRequest
  ) {
    return this.recommendationsService.reject(id, body?.reason, actorOf(req));
  }

  // ==================== PRICE HISTORY ====================

  @Get('offers/:offerId/history')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles(...READ_ROLES)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Historial de precio de la oferta' })
  async getPriceHistory(
    @Param('offerId') offerId: string,
    @Request() req: ScopedRequest,
    @Query('limit') limit?: string
  ) {
    return this.recommendationsService.history(offerId, Number(limit ?? 20), actorOf(req));
  }

  // ==================== REVENUE ESTIMATION ====================

  @Get('events/:eventId/revenue-estimate')
  @UseGuards(JwtAuthGuard, RolesGuard, EventOrgAccessGuard)
  @Roles(...READ_ROLES)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Estimate event revenue' })
  async estimateRevenue(@Param('eventId') eventId: string) {
    return await this.pricingService.estimateEventRevenue(eventId);
  }
}
