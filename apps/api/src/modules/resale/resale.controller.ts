import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Query,
  Request,
  HttpCode,
  NotFoundException,
} from '@nestjs/common';
import { PaymentService } from '../payment/payment.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ResaleService } from './resale.service';
import { ResaleCheckoutService } from './resale-checkout.service';
import { ResaleSellerPayoutService } from './resale-seller-payout.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Resale')
@Controller('resale')
export class ResaleController {
  constructor(
    private resaleService: ResaleService,
    private checkouts: ResaleCheckoutService,
    private payments: PaymentService,
    private sellerPayouts: ResaleSellerPayoutService
  ) {}

  // ==================== COMPRAR YA (cobro real) ====================

  @Post('listings/:listingId/buy')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Comprar un anuncio de reventa: crea el cobro y aparta el boleto' })
  async buy(@Param('listingId') listingId: string, @Request() req: { user: { sub: string } }) {
    return this.checkouts.start(req.user.sub, listingId);
  }

  @Get('checkouts/:publicId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Estado de una compra de reventa propia' })
  async checkoutStatus(
    @Param('publicId') publicId: string,
    @Request() req: { user: { sub: string } }
  ) {
    return this.checkouts.status(req.user.sub, publicId);
  }

  /** Solo demo: el comprador simula la confirmación del banco (404 en producción). */
  @Post('checkouts/:publicId/demo-confirm')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Demo: confirmar el pago de una compra de reventa propia' })
  async demoConfirm(
    @Param('publicId') publicId: string,
    @Request() req: { user: { sub: string } }
  ) {
    if (!this.payments.isBuyerDemoConfirmAvailable()) throw new NotFoundException();
    const own = await this.checkouts.status(req.user.sub, publicId);
    return this.payments.confirmBuyerDemoPurchase(own.id, own.publicId);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mis anuncios de reventa con lo que recibiré' })
  async mine(@Request() req: { user: { sub: string } }) {
    return this.checkouts.sellerSummary(req.user.sub);
  }

  @Get('mine/clabe')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'CLABE guardada para depósito de reventa' })
  async getClabe(@Request() req: { user: { sub: string } }) {
    return this.sellerPayouts.sellerClabeStatus(req.user.sub);
  }

  @Post('mine/clabe')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Guardar CLABE para depósito de reventa' })
  async saveClabe(@Request() req: { user: { sub: string } }, @Body() body: { clabe: string }) {
    return this.sellerPayouts.saveSellerClabe(req.user.sub, body?.clabe);
  }

  // ==================== CREATE LISTING ====================

  @Post('listings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create resale listing' })
  async createListing(
    @Body()
    dto: {
      ticketId?: string;
      ticketCode?: string;
      askingPrice: number;
      currency?: string;
      sellerName?: string;
    },
    @Request() req: { user: { sub: string; email?: string } }
  ) {
    return await this.resaleService.createListing({
      ...dto,
      sellerId: req.user.sub,
      sellerEmail: req.user.email,
      sellerName: dto.sellerName ?? req.user.email ?? 'Seller',
    });
  }

  // ==================== MAKE OFFER ====================

  @Post('listings/:listingId/offers')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Make offer on resale listing' })
  async makeOffer(
    @Param('listingId') listingId: string,
    @Body() dto: { offerPrice: number },
    @Request() req: { user: { sub: string; email?: string } }
  ) {
    return await this.resaleService.makeOffer({
      listingId,
      offerPrice: dto.offerPrice,
      buyerId: req.user.sub,
      buyerEmail: req.user.email ?? 'buyer@resale.local',
    });
  }

  // ==================== ACCEPT OFFER ====================

  @Post('offers/:offerId/accept')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Accept resale offer' })
  async acceptOffer(@Param('offerId') offerId: string, @Request() req: { user: { sub: string } }) {
    return await this.resaleService.acceptOffer(offerId, req.user.sub);
  }

  // ==================== REJECT OFFER ====================

  @Post('offers/:offerId/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject resale offer' })
  async rejectOffer(@Param('offerId') offerId: string, @Request() req: { user: { sub: string } }) {
    return await this.resaleService.rejectOffer(offerId, req.user.sub);
  }

  // ==================== CANCEL LISTING ====================

  @Post('listings/:listingId/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel resale listing' })
  async cancelListing(
    @Param('listingId') listingId: string,
    @Request() req: { user: { sub: string } }
  ) {
    return await this.resaleService.cancelListing(listingId, req.user.sub);
  }

  // ==================== LIST ACTIVE LISTINGS ====================

  @Get('listings')
  @ApiOperation({ summary: 'List active resale listings' })
  async listListings(
    @Query('eventId') eventId?: string,
    @Query('offerId') offerId?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number
  ) {
    return await this.resaleService.listActiveListings({
      eventId,
      offerId,
      limit,
      offset,
    });
  }

  // ==================== MARKETPLACE STATS ====================

  @Get('events/:eventId/stats')
  @ApiOperation({ summary: 'Get resale marketplace stats' })
  async getMarketplaceStats(@Param('eventId') eventId: string) {
    return await this.resaleService.getMarketplaceStats(eventId);
  }

  @Get('limits')
  @ApiOperation({ summary: 'Topes anti-scalping y cargo fijo de reventa' })
  limits() {
    return this.resaleService.limits();
  }

  // ==================== ANTI-SCALPING CHECK ====================

  @Get('tickets/:ticketId/anti-scalping-check')
  @ApiOperation({ summary: 'Check anti-scalping restrictions' })
  async performAntiScalpingCheck(@Param('ticketId') ticketId: string) {
    return await this.resaleService.performAntiScalpingCheck(ticketId);
  }
}
