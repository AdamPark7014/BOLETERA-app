import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ResaleStatus, ResaleOfferStatus, SalesChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class ResaleService {
  private logger = new Logger(ResaleService.name);

  private readonly RESALE_FEE_PERCENT = 0.08; // 8%
  private readonly MIN_RESALE_PRICE_PERCENT = 0.5; // Can't sell below 50% of original
  private readonly MAX_RESALE_PRICE_PERCENT = 2.0; // Can't sell above 200% of original

  constructor(private prisma: PrismaService) {}

  // ==================== CREATE RESALE LISTING ====================

  async createListing(data: {
    ticketId?: string;
    ticketCode?: string;
    askingPrice: number;
    currency?: string;
    sellerId: string;
    sellerName?: string;
  }) {
    const ticket = data.ticketId
      ? await this.prisma.ticket.findUnique({
          where: { id: data.ticketId },
          include: { offer: true, event: true },
        })
      : await this.prisma.ticket.findFirst({
          where: { code: data.ticketCode },
          include: { offer: true, event: true },
        });

    if (!ticket) throw new NotFoundException('Ticket not found');

    return this.createListingForTicket(ticket, {
      askingPrice: data.askingPrice,
      currency: data.currency ?? 'USD',
      sellerId: data.sellerId,
      sellerName: data.sellerName ?? 'Seller',
    });
  }

  private async createListingForTicket(
    ticket: {
      id: string;
      status: string;
      orderItemId: string | null;
      offer: { basePrice: unknown };
      event: { allowResale: boolean };
    },
    data: { askingPrice: number; currency: string; sellerId: string; sellerName: string },
  ) {
    if (ticket.status !== 'SOLD') throw new BadRequestException('Ticket must be in SOLD status');
    if (!ticket.orderItemId) throw new BadRequestException('Ticket must have order history');
    if (!ticket.event.allowResale) {
      throw new BadRequestException('Resale not allowed for this event');
    }

    // Validate price bounds
    const originalPrice = Number(ticket.offer.basePrice);
    const minPrice = originalPrice * this.MIN_RESALE_PRICE_PERCENT;
    const maxPrice = originalPrice * this.MAX_RESALE_PRICE_PERCENT;

    if (data.askingPrice < minPrice || data.askingPrice > maxPrice) {
      throw new BadRequestException(
        `Price must be between ${minPrice.toFixed(2)} and ${maxPrice.toFixed(2)}`,
      );
    }

    // Create listing
    const fee = new Decimal(data.askingPrice * this.RESALE_FEE_PERCENT);
    const listing = await this.prisma.resaleListing.create({
      data: {
        ticketId: ticket.id,
        sellerId: data.sellerId,
        sellerName: data.sellerName,
        askingPrice: new Decimal(data.askingPrice),
        currency: data.currency as 'USD' | 'MXN' | 'EUR',
        fee,
        status: ResaleStatus.ACTIVE,
      },
    });

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'RESOLD', resalePrice: new Decimal(data.askingPrice) },
    });

    this.logger.log(`Resale listing created: ${listing.id} for ticket ${ticket.id}`);

    return listing;
  }

  // ==================== MAKE OFFER ====================

  async makeOffer(data: {
    listingId: string;
    offerPrice: number;
    buyerId: string;
    buyerEmail: string;
  }) {
    const listing = await this.prisma.resaleListing.findUnique({
      where: { id: data.listingId },
    });

    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.status !== ResaleStatus.ACTIVE) {
      throw new ConflictException('Listing is not active');
    }

    if (data.offerPrice > Number(listing.askingPrice)) {
      throw new BadRequestException('Offer price cannot exceed asking price');
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hour expiration

    const offer = await this.prisma.resaleOffer.create({
      data: {
        listingId: data.listingId,
        buyerId: data.buyerId,
        buyerEmail: data.buyerEmail,
        offerPrice: new Decimal(data.offerPrice),
        status: ResaleOfferStatus.PENDING,
        expiresAt,
      },
    });

    this.logger.log(`Resale offer created: ${offer.id} for listing ${data.listingId}`);

    return offer;
  }

  // ==================== ACCEPT OFFER ====================

  async acceptOffer(offerId: string) {
    const offer = await this.prisma.resaleOffer.findUnique({
      where: { id: offerId },
      include: { listing: { include: { ticket: { include: { event: true } } } } },
    });

    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.status !== ResaleOfferStatus.PENDING) {
      throw new BadRequestException('Offer is not pending');
    }

    return await this.prisma.$transaction(async (tx) => {
      // Update offer status
      await tx.resaleOffer.update({
        where: { id: offerId },
        data: { status: ResaleOfferStatus.ACCEPTED, respondedAt: new Date() },
      });

      // Update listing
      await tx.resaleListing.update({
        where: { id: offer.listingId },
        data: { status: ResaleStatus.SOLD, soldAt: new Date() },
      });

      // Transfer ticket to buyer
      const transferTicket = await tx.ticket.update({
        where: { id: offer.listing.ticketId },
        data: {
          status: 'SOLD',
          buyerName: undefined,
          buyerEmail: offer.buyerEmail,
        },
      });

      // Create resale order for settlement tracking
      const resaleOrder = await tx.order.create({
        data: {
          publicId: `RESALE-${Date.now().toString(36).toUpperCase()}`,
          organizationId: offer.listing.ticket.event.organizationId,
          eventId: offer.listing.ticket.eventId,
          userId: offer.buyerId,
          buyerEmail: offer.buyerEmail,
          buyerName: 'Resale Buyer',
          status: 'COMPLETED',
          channel: SalesChannel.RESALE,
          subtotal: offer.offerPrice,
          fees: offer.listing.fee,
          discountAmount: new Decimal(0),
          taxAmount: new Decimal(0),
          totalAmount: offer.offerPrice.plus(offer.listing.fee),
          commissionAmount: offer.listing.fee,
          currency: offer.listing.currency,
          completedAt: new Date(),
          expiresAt: new Date(),
        },
      });

      this.logger.log(
        `Resale offer accepted: ${offerId}, ticket transferred to ${offer.buyerEmail}`,
      );

      return { resaleOrder, transferTicket };
    });
  }

  // ==================== REJECT OFFER ====================

  async rejectOffer(offerId: string) {
    const offer = await this.prisma.resaleOffer.update({
      where: { id: offerId },
      data: {
        status: ResaleOfferStatus.REJECTED,
        respondedAt: new Date(),
      },
    });

    this.logger.log(`Resale offer rejected: ${offerId}`);

    return offer;
  }

  // ==================== CANCEL LISTING ====================

  async cancelListing(listingId: string) {
    const listing = await this.prisma.resaleListing.findUnique({
      where: { id: listingId },
    });

    if (!listing) throw new NotFoundException('Listing not found');

    await this.prisma.resaleListing.update({
      where: { id: listingId },
      data: { status: ResaleStatus.CANCELLED },
    });

    // Revert ticket status to SOLD
    await this.prisma.ticket.update({
      where: { id: listing.ticketId },
      data: { status: 'SOLD', resalePrice: null },
    });

    this.logger.log(`Resale listing cancelled: ${listingId}`);

    return listing;
  }

  // ==================== LIST ACTIVE LISTINGS ====================

  async listActiveListings(params: {
    eventId?: string;
    offerId?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = { status: ResaleStatus.ACTIVE };

    if (params.eventId) {
      where.ticket = { eventId: params.eventId };
    }

    if (params.offerId) {
      where.ticket = { ...where.ticket, offerId: params.offerId };
    }

    const listings = await this.prisma.resaleListing.findMany({
      where,
      include: {
        ticket: {
          include: { offer: true, event: true },
        },
        offers: { where: { status: ResaleOfferStatus.PENDING } },
      },
      orderBy: { listedAt: 'desc' },
      take: params.limit ?? 50,
      skip: params.offset ?? 0,
    });

    return listings.map((listing) => ({
      ...listing,
      priceComparison: {
        originalPrice: Number(listing.ticket.offer.basePrice),
        resalePrice: Number(listing.askingPrice),
        markup: (
          ((Number(listing.askingPrice) / Number(listing.ticket.offer.basePrice)) * 100 - 100)
        ).toFixed(1),
      },
      pendingOffers: listing.offers.length,
    }));
  }

  // ==================== MARKETPLACE STATS ====================

  async getMarketplaceStats(eventId: string) {
    const [activeListings, soldListings, totalVolume, avgPrice, priceRange] = await Promise.all([
      this.prisma.resaleListing.count({
        where: {
          status: ResaleStatus.ACTIVE,
          ticket: { eventId },
        },
      }),
      this.prisma.resaleListing.count({
        where: {
          status: ResaleStatus.SOLD,
          ticket: { eventId },
        },
      }),
      this.getResaleVolume(eventId),
      this.getAverageResalePrice(eventId),
      this.getPriceRange(eventId),
    ]);

    return {
      eventId,
      activeListings,
      soldListings,
      totalVolume,
      avgResalePrice: avgPrice,
      priceRange,
      markup: {
        min: ((priceRange.min / priceRange.original) * 100 - 100).toFixed(1),
        max: ((priceRange.max / priceRange.original) * 100 - 100).toFixed(1),
        avg: ((avgPrice / priceRange.original) * 100 - 100).toFixed(1),
      },
    };
  }

  // ==================== ANTI-SCALPING CHECKS ====================

  async performAntiScalpingCheck(ticketId: string): Promise<{
    allowed: boolean;
    reason?: string;
    maxPrice?: number;
  }> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { offer: true, event: true },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');

    const originalPrice = Number(ticket.offer.basePrice);
    const maxAllowedPrice = originalPrice * this.MAX_RESALE_PRICE_PERCENT;

    // Check if event has transfer restrictions
    if (ticket.event.nonTransferable) {
      return {
        allowed: false,
        reason: 'This ticket is non-transferable',
      };
    }

    // Check cooldown period (can't resell within 24 hours of purchase)
    const purchaseTime = ticket.createdAt;
    const hoursSincePurchase = (Date.now() - purchaseTime.getTime()) / (1000 * 60 * 60);

    if (hoursSincePurchase < 24) {
      return {
        allowed: false,
        reason: `Cannot resell within 24 hours of purchase. Hours remaining: ${(24 - hoursSincePurchase).toFixed(1)}`,
      };
    }

    return {
      allowed: true,
      maxPrice: maxAllowedPrice,
    };
  }

  // ==================== HELPER METHODS ====================

  private async getResaleVolume(eventId: string): Promise<number> {
    const sold = await this.prisma.resaleListing.findMany({
      where: {
        status: ResaleStatus.SOLD,
        ticket: { eventId },
      },
      select: { askingPrice: true },
    });

    return sold.reduce((sum, listing) => sum + Number(listing.askingPrice), 0);
  }

  private async getAverageResalePrice(eventId: string): Promise<number> {
    const result = await this.prisma.resaleListing.aggregate({
      _avg: { askingPrice: true },
      where: {
        ticket: { eventId },
      },
    });

    return Number(result._avg.askingPrice) || 0;
  }

  private async getPriceRange(eventId: string): Promise<{
    min: number;
    max: number;
    original: number;
  }> {
    const [resale, original] = await Promise.all([
      this.prisma.resaleListing.aggregate({
        _min: { askingPrice: true },
        _max: { askingPrice: true },
        where: { ticket: { eventId } },
      }),
      this.prisma.ticket.aggregate({
        _avg: { originalPrice: true },
        where: { eventId },
      }),
    ]);

    return {
      min: Number(resale._min.askingPrice) || 0,
      max: Number(resale._max.askingPrice) || 0,
      original: Number(original._avg.originalPrice) || 0,
    };
  }
}


