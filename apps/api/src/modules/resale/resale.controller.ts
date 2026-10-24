import { Controller, Post, Get, Body, Param, UseGuards, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ResaleService } from './resale.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Resale')
@Controller('resale')
export class ResaleController {
  constructor(private resaleService: ResaleService) {}

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
    @Request() req: { user: { sub: string; email?: string } },
  ) {
    return await this.resaleService.createListing({
      ...dto,
      sellerId: req.user.sub,
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
    @Request() req: { user: { sub: string; email?: string } },
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
  async acceptOffer(@Param('offerId') offerId: string) {
    return await this.resaleService.acceptOffer(offerId);
  }

  // ==================== REJECT OFFER ====================

  @Post('offers/:offerId/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject resale offer' })
  async rejectOffer(@Param('offerId') offerId: string) {
    return await this.resaleService.rejectOffer(offerId);
  }

  // ==================== CANCEL LISTING ====================

  @Post('listings/:listingId/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel resale listing' })
  async cancelListing(@Param('listingId') listingId: string) {
    return await this.resaleService.cancelListing(listingId);
  }

  // ==================== LIST ACTIVE LISTINGS ====================

  @Get('listings')
  @ApiOperation({ summary: 'List active resale listings' })
  async listListings(
    @Query('eventId') eventId?: string,
    @Query('offerId') offerId?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
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


