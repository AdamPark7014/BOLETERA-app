import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { validateBanorteProductionConfig } from '@boletera/payments';
import { normalizeSeatMap, resolveGeometry, validateGeometry } from '@boletera/venue-engine';
import { PrismaService } from '../prisma/prisma.service';
import { VenueLayoutService } from '../venue-layout/venue-layout.service';
import {
  buildEventPublishValidation,
  channelConfigFromMetadata,
  hasCapacityExplanation,
  hasDocumentedRefundTerms,
  type EventPublishValidation,
} from './event-publish-validation';

@Injectable()
export class EventPublishValidationService {
  constructor(
    private prisma: PrismaService,
    private venueLayout: VenueLayoutService
  ) {}

  async validateEventForPublish(
    eventId: string,
    organizationId: string
  ): Promise<EventPublishValidation> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId },
      include: {
        venue: { select: { id: true, name: true } },
        offers: { where: { isAvailable: true }, select: { id: true, basePrice: true } },
        seatMap: { select: { id: true, publishedAt: true } },
        _count: { select: { tickets: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    const metadata = (event.metadata as Record<string, unknown> | null) ?? null;

    let mapSummary: {
      sectionCount: number;
      seatCount: number;
      geometryErrors: number;
      geometryWarnings: number;
      layoutPublishStatus: string | null;
    } | null = null;

    if (event.venue) {
      try {
        const layoutPayload = await this.venueLayout.getActiveLayout(
          event.venue.id,
          organizationId
        );
        const mapData = layoutPayload.layout.mapData;
        const normalized = normalizeSeatMap(mapData);
        const geometry = validateGeometry(resolveGeometry(normalized), {
          declaredCapacity: event.totalCapacity,
        });
        // capacity_mismatch se reporta en el check `capacity`, no como error de mapa.
        const otherIssues = geometry.issues.filter((i) => i.code !== 'capacity_mismatch');
        const seatCount = normalized.sections.reduce((n, s) => n + s.seats.length, 0);
        mapSummary = {
          sectionCount: normalized.sections.length,
          seatCount,
          geometryErrors: otherIssues.filter((i) => i.severity === 'error').length,
          geometryWarnings: otherIssues.filter((i) => i.severity === 'warning').length,
          layoutPublishStatus: layoutPayload.layout.publishStatus ?? null,
        };
      } catch {
        mapSummary = null;
      }
    }

    const minPrice = Number(event.minPrice);
    const pricedOffers = event.offers.filter((o) => Number(o.basePrice) > 0);
    const unpricedOffers = event.offers.filter((o) => Number(o.basePrice) <= 0);

    const payment = validateBanorteProductionConfig();
    const channels = channelConfigFromMetadata(metadata);

    const salesStartAt = event.salesStartAt ? new Date(event.salesStartAt) : null;
    const salesEndAt = event.salesEndAt ? new Date(event.salesEndAt) : null;
    const startsAt = event.startsAt ? new Date(event.startsAt) : null;
    let salesValid = true;
    let salesMessage: string | undefined;
    if (salesStartAt && salesEndAt) {
      if (Number.isNaN(salesStartAt.getTime()) || Number.isNaN(salesEndAt.getTime())) {
        salesValid = false;
        salesMessage = 'La ventana de venta tiene fechas inválidas.';
      } else if (salesEndAt <= salesStartAt) {
        salesValid = false;
        salesMessage = 'La venta no puede cerrar antes de abrir.';
      } else if (startsAt && !Number.isNaN(startsAt.getTime()) && salesEndAt > startsAt) {
        salesValid = false;
        salesMessage =
          'La venta no puede cerrar después de que empiece el evento; usa una fase de venta en puerta.';
      }
    }

    const seatCount = mapSummary?.seatCount ?? 0;
    const capacityMatch =
      seatCount > 0
        ? {
            declared: event.totalCapacity,
            mapSeats: seatCount,
            matches: event.totalCapacity === seatCount,
            hasExplanation: hasCapacityExplanation(metadata),
          }
        : null;

    return buildEventPublishValidation({
      eventId,
      venue: event.venue,
      map: mapSummary,
      pricing: {
        minPrice,
        offerCount: event.offers.length,
        pricedOfferCount: pricedOffers.length,
        unpricedOfferCount: unpricedOffers.length,
      },
      payment: {
        ready: payment.ready,
        demo: payment.demo,
        missing: payment.missing,
        warnings: payment.warnings,
      },
      refund: {
        refundable: event.refundable,
        hasDocumentedTerms: hasDocumentedRefundTerms(metadata),
      },
      images: {
        hasImage: Boolean(event.image?.trim()),
        hasBanner: Boolean(event.bannerImage?.trim()),
      },
      channels,
      inventory: {
        published: Boolean(event.publishedAt ?? event.seatMap?.publishedAt),
        ticketCount: event._count.tickets,
        layoutSeatCount: seatCount,
        totalCapacity: event.totalCapacity,
      },
      salesWindow: {
        hasStart: Boolean(salesStartAt),
        hasEnd: Boolean(salesEndAt),
        valid: salesValid,
        message: salesMessage,
      },
      capacityMatch,
    });
  }

  /** Throws when blockers remain — used by publish endpoint. */
  async assertReadyForPublish(
    eventId: string,
    organizationId: string
  ): Promise<EventPublishValidation> {
    const result = await this.validateEventForPublish(eventId, organizationId);
    if (!result.ready) {
      const blockers = result.checks.filter((c) => c.status === 'blocker');
      throw new BadRequestException({
        message: 'El evento no cumple los requisitos para publicar.',
        validation: result,
        blockers: blockers.map((b) => ({
          id: b.id,
          message: b.message,
          action: b.action ?? null,
        })),
      });
    }
    return result;
  }
}
