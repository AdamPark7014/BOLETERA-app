import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventStatus, TicketStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { SeatMapData, SeatMapSection } from '@boletera/shared';
import {
  generateLayoutTemplate,
  suggestTemplateFromPrompt,
  buildEgressReport,
  exportEgressReportToCsv,
  egressReportFilename,
  summarizeEgressReport,
  exportEgressOverviewCsv,
  type LayoutTemplateId,
  type EgressReport,
  type EgressReportSummaryRow,
} from '@boletera/venue-engine';
import { generateTicketCode } from '@boletera/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelManagementService } from '../channel-management/channel-management.service';
import { buildEgressPdfBuffer, egressPdfFilename } from './egress-pdf';

@Injectable()
export class VenueLayoutService {
  private logger = new Logger(VenueLayoutService.name);

  constructor(
    private prisma: PrismaService,
    private channels: ChannelManagementService,
  ) {}

  async getActiveLayout(venueId: string, organizationId: string) {
    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, organizationId },
      include: {
        layouts: {
          where: { isActive: true },
          orderBy: { updatedAt: 'desc' },
          take: 1,
          include: {
            sections: {
              include: { seats: { include: { row: true } } },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });
    if (!venue) throw new NotFoundException('Venue not found');

    let layout = venue.layouts[0];
    if (!layout) {
      layout = await this.prisma.venueLayout.create({
        data: {
          venueId,
          name: 'Layout principal',
          mapData: { sections: [], viewport: { width: 800, height: 500 } },
        },
        include: {
          sections: {
            include: { seats: { include: { row: true } } },
            orderBy: { sortOrder: 'asc' as const },
          },
        },
      });
    }

    const mapData = this.layoutToMapData(layout);
    return { venue: { id: venue.id, name: venue.name, slug: venue.slug }, layout: { ...layout, mapData } };
  }

  private layoutToMapData(layout: {
    metadata?: unknown;
    sections: Array<{
      id: string;
      name: string;
      slug: string;
      color: string;
      metadata?: unknown;
      seats: Array<{
        id: string;
        label: string;
        x: number;
        y: number;
        rotation?: number | null;
        tier: string | null;
        coord3d: unknown;
        viewQuality?: number | null;
        row?: { label: string } | null;
      }>;
    }>;
    mapData: unknown;
  }): SeatMapData {
    if (layout.sections.length > 0) {
      const stored = (layout.mapData as SeatMapData | null) ?? null;
      const sections = layout.sections.map((sec) => {
        const meta = (sec.metadata as Record<string, unknown> | null) ?? {};
        return {
          id: sec.id,
          name: sec.name,
          slug: sec.slug,
          color: sec.color,
          shape: (meta.shape as SeatMapSection['shape']) ?? undefined,
          blocks: (meta.blocks as SeatMapSection['blocks']) ?? undefined,
          rake: typeof meta.rake === 'number' ? meta.rake : undefined,
          seatPitch: typeof meta.seatPitch === 'number' ? meta.seatPitch : undefined,
          rowPitch: typeof meta.rowPitch === 'number' ? meta.rowPitch : undefined,
          curvature: typeof meta.curvature === 'number' ? meta.curvature : undefined,
          levelId: typeof meta.levelId === 'string' ? meta.levelId : undefined,
          seats: sec.seats.map((s) => {
            const c3 = s.coord3d as
              | {
                  x: number;
                  y: number;
                  z: number;
                  pitch?: number;
                  roll?: number;
                  visibility?: SeatMapData['sections'][0]['seats'][0]['visibility'];
                  levelId?: string;
                  metadata?: Record<string, unknown>;
                }
              | null
              | undefined;
            const visibility =
              c3?.visibility ??
              (s.viewQuality != null
                ? s.viewQuality <= 0
                  ? { blocked: true }
                  : s.viewQuality <= 0.5
                    ? { restrictedView: true }
                    : s.viewQuality >= 0.95
                      ? { premiumView: true }
                      : undefined
                : undefined);
            return {
              id: s.id,
              label: s.label,
              x: s.x,
              y: s.y,
              rotation: s.rotation ?? undefined,
              tier: s.tier ?? 'standard',
              row: s.row?.label ?? undefined,
              coord3d: c3
                ? { x: c3.x, y: c3.y, z: c3.z, pitch: c3.pitch, roll: c3.roll }
                : undefined,
              position: c3 ? { x: c3.x, y: c3.y, z: c3.z } : undefined,
              elevation: c3?.y,
              rotation3d:
                c3 || s.rotation != null
                  ? {
                      x: c3?.pitch ?? 0,
                      y: s.rotation ?? 0,
                      z: c3?.roll ?? 0,
                    }
                  : undefined,
              visibility,
              levelId: c3?.levelId,
              metadata: c3?.metadata,
            };
          }),
        };
      });
      const xs = sections.flatMap((s) => s.seats.map((seat) => seat.x));
      const ys = sections.flatMap((s) => s.seats.map((seat) => seat.y));
      const pad = 40;
      const minX = (xs.length ? Math.min(...xs) : 0) - pad;
      const minY = (ys.length ? Math.min(...ys) : 0) - pad;
      const maxX = (xs.length ? Math.max(...xs) : 800) + pad;
      const maxY = (ys.length ? Math.max(...ys) : 500) + pad;
      return {
        version: 3,
        sections,
        viewport: {
          minX,
          minY,
          width: Math.max(maxX - minX, 100),
          height: Math.max(maxY - minY, 100),
        },
        venue: stored?.venue ?? (layout.metadata as SeatMapData['venue']) ?? undefined,
      };
    }
    return (layout.mapData as SeatMapData) ?? {
      version: 3,
      sections: [],
      viewport: { width: 800, height: 500, minX: 0, minY: 0 },
    };
  }

  private seatCoord3d(seat: SeatMapData['sections'][0]['seats'][0]): object | undefined {
    const elev = seat.elevation ?? seat.position?.y ?? seat.coord3d?.y ?? 0;
    const x = seat.position?.x ?? seat.coord3d?.x ?? seat.x;
    const z = seat.position?.z ?? seat.coord3d?.z ?? seat.y;
    const pitch = seat.rotation3d?.x ?? seat.coord3d?.pitch;
    const roll = seat.rotation3d?.z ?? seat.coord3d?.roll;
    return {
      x,
      y: elev,
      z,
      ...(pitch != null ? { pitch } : {}),
      ...(roll != null ? { roll } : {}),
      ...(seat.visibility ? { visibility: seat.visibility } : {}),
      ...(seat.levelId ? { levelId: seat.levelId } : {}),
      ...(seat.metadata ? { metadata: seat.metadata } : {}),
    };
  }

  private viewQualityFromVisibility(
    visibility: SeatMapData['sections'][0]['seats'][0]['visibility'],
  ): number | null {
    if (!visibility) return null;
    if (visibility.blocked) return 0;
    if (visibility.restrictedView) return 0.4;
    if (visibility.premiumView) return 1;
    return null;
  }

  async saveMap(venueId: string, organizationId: string, mapData: SeatMapData) {
    const { layout } = await this.getActiveLayout(venueId, organizationId);

    await this.prisma.$transaction(async (tx) => {
      // Ensure a single active layout per venue (legacy seeds left orphans).
      await tx.venueLayout.updateMany({
        where: { venueId, id: { not: layout.id }, isActive: true },
        data: { isActive: false },
      });

      const existingSections = await tx.section.findMany({
        where: { layoutId: layout.id },
        include: { seats: true, rows: true },
      });
      const keepSectionIds = new Set(mapData.sections.map((s) => s.id).filter(Boolean));
      const orphanSections = existingSections.filter((s) => !keepSectionIds.has(s.id));
      if (orphanSections.length) {
        await tx.seat.deleteMany({
          where: { sectionId: { in: orphanSections.map((s) => s.id) } },
        });
        await tx.seatRow.deleteMany({
          where: { sectionId: { in: orphanSections.map((s) => s.id) } },
        });
        await tx.section.deleteMany({
          where: { id: { in: orphanSections.map((s) => s.id) } },
        });
      }

      for (let i = 0; i < mapData.sections.length; i++) {
        const sec = mapData.sections[i];
        let section = sec.id
          ? await tx.section.findFirst({ where: { id: sec.id, layoutId: layout.id } })
          : null;
        if (!section && sec.slug) {
          section = await tx.section.findFirst({
            where: { layoutId: layout.id, slug: sec.slug },
          });
        }

        const sectionMetadata = {
          ...(sec.shape ? { shape: sec.shape } : {}),
          ...(sec.blocks ? { blocks: sec.blocks } : {}),
          ...(sec.rake != null ? { rake: sec.rake } : {}),
          ...(sec.seatPitch != null ? { seatPitch: sec.seatPitch } : {}),
          ...(sec.rowPitch != null ? { rowPitch: sec.rowPitch } : {}),
          ...(sec.curvature != null ? { curvature: sec.curvature } : {}),
          ...(sec.levelId ? { levelId: sec.levelId } : {}),
        };
        const sectionMetadataPayload =
          Object.keys(sectionMetadata).length > 0 ? (sectionMetadata as object) : null;

        if (section) {
          section = await tx.section.update({
            where: { id: section.id },
            data: {
              name: sec.name,
              slug: sec.slug || `section-${i}`,
              color: sec.color || '#737373',
              sortOrder: i,
              metadata: sectionMetadataPayload,
            },
          });
        } else {
          const createData: {
            id?: string;
            layoutId: string;
            name: string;
            slug: string;
            color: string;
            sortOrder: number;
            metadata: object | null;
          } = {
            layoutId: layout.id,
            name: sec.name,
            slug: sec.slug || `section-${i}`,
            color: sec.color || '#737373',
            sortOrder: i,
            metadata: sectionMetadataPayload,
          };
          if (sec.id && !sec.id.startsWith('tmp-')) createData.id = sec.id;
          section = await tx.section.create({ data: createData });
        }

        const rowLabels = Array.from(
          new Set(sec.seats.map((s) => s.row || s.label.split('-')[0] || 'A')),
        );
        const rowByLabel = new Map<string, string>();
        for (let ri = 0; ri < rowLabels.length; ri++) {
          const label = rowLabels[ri];
          const existingRow = await tx.seatRow.findFirst({
            where: { sectionId: section.id, label },
          });
          if (existingRow) {
            rowByLabel.set(label, existingRow.id);
          } else {
            const row = await tx.seatRow.create({
              data: { sectionId: section.id, label, sortOrder: ri },
            });
            rowByLabel.set(label, row.id);
          }
        }

        const keepSeatIds = Array.from(
          new Set(sec.seats.map((s) => s.id).filter(Boolean)),
        );
        if (keepSeatIds.length) {
          await tx.seat.deleteMany({
            where: {
              sectionId: section.id,
              id: { notIn: keepSeatIds },
            },
          });
        } else {
          await tx.seat.deleteMany({ where: { sectionId: section.id } });
        }

        for (const seat of sec.seats) {
          const rowLabel = seat.row || seat.label.split('-')[0] || 'A';
          const rowId = rowByLabel.get(rowLabel)!;
          const existing = seat.id
            ? await tx.seat.findFirst({ where: { id: seat.id } })
            : null;
          if (existing) {
            await tx.seat.update({
              where: { id: existing.id },
              data: {
                sectionId: section.id,
                label: seat.label,
                x: seat.x,
                y: seat.y,
                rotation: seat.rotation ?? seat.rotation3d?.y ?? 0,
                tier: seat.tier ?? 'standard',
                rowId,
                coord3d: this.seatCoord3d(seat),
                viewQuality: this.viewQualityFromVisibility(seat.visibility),
              },
            });
          } else {
            const seatData: {
              id?: string;
              sectionId: string;
              rowId: string;
              label: string;
              x: number;
              y: number;
              rotation: number;
              tier: string;
              coord3d?: object;
              viewQuality?: number | null;
            } = {
              sectionId: section.id,
              rowId,
              label: seat.label,
              x: seat.x,
              y: seat.y,
              rotation: seat.rotation ?? seat.rotation3d?.y ?? 0,
              tier: seat.tier ?? 'standard',
              coord3d: this.seatCoord3d(seat),
              viewQuality: this.viewQualityFromVisibility(seat.visibility),
            };
            if (seat.id && !seat.id.startsWith('tmp-')) seatData.id = seat.id;
            await tx.seat.create({ data: seatData });
          }
        }
      }

      // Refresh mapData with DB ids
      const refreshed = await tx.venueLayout.findUnique({
        where: { id: layout.id },
        include: {
          sections: {
            include: { seats: { include: { row: true } } },
            orderBy: { sortOrder: 'asc' },
          },
        },
      });
      const nextMap = refreshed ? this.layoutToMapData(refreshed) : mapData;
      if (mapData.venue) nextMap.venue = mapData.venue;
      // Preserve section geometry params that may only exist on inbound payload
      for (const sec of mapData.sections) {
        const target = nextMap.sections.find(
          (s) => s.id === sec.id || s.slug === sec.slug,
        );
        if (!target) continue;
        if (sec.blocks) target.blocks = sec.blocks;
        if (sec.rake != null) target.rake = sec.rake;
        if (sec.seatPitch != null) target.seatPitch = sec.seatPitch;
        if (sec.rowPitch != null) target.rowPitch = sec.rowPitch;
        if (sec.curvature != null) target.curvature = sec.curvature;
        if (sec.levelId) target.levelId = sec.levelId;
      }
      nextMap.version = 3;

      await tx.venueLayout.update({
        where: { id: layout.id },
        data: {
          mapData: nextMap as object,
          metadata: (mapData.venue as object) ?? undefined,
          version: { increment: 1 },
        },
      });
    });

    this.logger.log(`Map saved for venue ${venueId}`);
    return this.getActiveLayout(venueId, organizationId);
  }

  async applyTemplate(
    venueId: string,
    organizationId: string,
    template: LayoutTemplateId,
    opts?: { capacity?: number; sectionCount?: number },
  ) {
    const mapData = generateLayoutTemplate(template, {
      capacity: opts?.capacity,
      sectionCount: opts?.sectionCount,
      idPrefix: `${venueId.slice(-6)}-${template}`,
    });
    return this.saveMap(venueId, organizationId, mapData);
  }

  async suggestFromPrompt(venueId: string, organizationId: string, prompt: string) {
    const { template, capacity } = suggestTemplateFromPrompt(prompt);
    return this.applyTemplate(venueId, organizationId, template, { capacity });
  }

  async importAiSections(venueId: string, organizationId: string, sections: SeatMapSection[]) {
    const current = await this.getActiveLayout(venueId, organizationId);
    const mapData: SeatMapData = {
      ...(current.layout.mapData as SeatMapData),
      sections: sections.map((s, i) => ({
        ...s,
        id: s.id || `sec-${i}`,
        slug: s.slug || `section-${i}`,
        color: s.color || '#404040',
      })),
    };
    return this.saveMap(venueId, organizationId, mapData);
  }

  /**
   * Egress / circulation report for the active venue layout.
   * Optional `mapData` analyzes an unsaved editor draft.
   */
  async getEgressReport(
    venueId: string,
    organizationId: string,
    opts?: { mapData?: SeatMapData; format?: 'json' | 'csv' | 'pdf' },
  ): Promise<
    | { format: 'json'; report: EgressReport; filename: string }
    | { format: 'csv'; csv: string; filename: string; report: EgressReport }
    | { format: 'pdf'; pdf: Buffer; filename: string; report: EgressReport }
  > {
    const current = await this.getActiveLayout(venueId, organizationId);
    const mapData = opts?.mapData ?? (current.layout.mapData as SeatMapData);
    if (!mapData?.sections?.length) {
      throw new BadRequestException('El venue no tiene mapa con secciones.');
    }
    const venueName = current.venue?.name ?? 'venue';
    const report = buildEgressReport(mapData, { venueName });
    if (opts?.format === 'csv') {
      return {
        format: 'csv',
        csv: exportEgressReportToCsv(report),
        filename: egressReportFilename(venueName),
        report,
      };
    }
    if (opts?.format === 'pdf') {
      const pdf = await buildEgressPdfBuffer(report);
      return {
        format: 'pdf',
        pdf,
        filename: egressPdfFilename(venueName),
        report,
      };
    }
    return { format: 'json', report, filename: egressReportFilename(venueName) };
  }

  /**
   * Org-wide egress health: one summary row per venue with an active layout.
   */
  async getEgressOverview(organizationId: string): Promise<{
    generatedAt: string;
    venues: Array<EgressReportSummaryRow & { venueId: string; layoutId: string | null }>;
    counts: { ok: number; warn: number; critical: number; noNetwork: number; empty: number };
  }> {
    const venues = await this.prisma.venue.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      include: {
        layouts: {
          where: { isActive: true },
          orderBy: { updatedAt: 'desc' },
          take: 1,
          include: {
            sections: {
              include: { seats: { include: { row: true } } },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });

    const rows: Array<EgressReportSummaryRow & { venueId: string; layoutId: string | null }> = [];

    for (const venue of venues) {
      const layout = venue.layouts[0];
      if (!layout) {
        rows.push({
          venueId: venue.id,
          layoutId: null,
          venueName: venue.name,
          hasNetwork: false,
          sections: 0,
          unreachable: 0,
          seatsWithPath: 0,
          seatsWithoutPath: 0,
          clearanceMinutes: null,
          maxPathLength: null,
          avgPathLength: null,
          topBottleneckUtilization: null,
          topBottleneckKind: null,
          status: 'empty',
          statusReason: 'Sin layout activo',
        });
        continue;
      }

      let mapData: SeatMapData;
      try {
        mapData = this.layoutToMapData(layout);
      } catch (err) {
        this.logger.warn(`Egress overview map parse failed for venue ${venue.id}: ${String(err)}`);
        rows.push({
          venueId: venue.id,
          layoutId: layout.id,
          venueName: venue.name,
          hasNetwork: false,
          sections: 0,
          unreachable: 0,
          seatsWithPath: 0,
          seatsWithoutPath: 0,
          clearanceMinutes: null,
          maxPathLength: null,
          avgPathLength: null,
          topBottleneckUtilization: null,
          topBottleneckKind: null,
          status: 'empty',
          statusReason: 'Error al leer mapa',
        });
        continue;
      }

      if (!mapData.sections?.length) {
        rows.push({
          venueId: venue.id,
          layoutId: layout.id,
          venueName: venue.name,
          hasNetwork: false,
          sections: 0,
          unreachable: 0,
          seatsWithPath: 0,
          seatsWithoutPath: 0,
          clearanceMinutes: null,
          maxPathLength: null,
          avgPathLength: null,
          topBottleneckUtilization: null,
          topBottleneckKind: null,
          status: 'empty',
          statusReason: 'Mapa vacío',
        });
        continue;
      }

      try {
        const report = buildEgressReport(mapData, { venueName: venue.name });
        const summary = summarizeEgressReport(report);
        rows.push({ ...summary, venueId: venue.id, layoutId: layout.id });
      } catch (err) {
        this.logger.warn(`Egress overview failed for venue ${venue.id}: ${String(err)}`);
        rows.push({
          venueId: venue.id,
          layoutId: layout.id,
          venueName: venue.name,
          hasNetwork: false,
          sections: mapData.sections.length,
          unreachable: 0,
          seatsWithPath: 0,
          seatsWithoutPath: 0,
          clearanceMinutes: null,
          maxPathLength: null,
          avgPathLength: null,
          topBottleneckUtilization: null,
          topBottleneckKind: null,
          status: 'empty',
          statusReason: 'Error al analizar',
        });
      }
    }

    const counts = {
      ok: rows.filter((r) => r.status === 'ok').length,
      warn: rows.filter((r) => r.status === 'warn').length,
      critical: rows.filter((r) => r.status === 'critical').length,
      noNetwork: rows.filter((r) => r.status === 'no-network').length,
      empty: rows.filter((r) => r.status === 'empty').length,
    };

    return { generatedAt: new Date().toISOString(), venues: rows, counts };
  }

  async exportEgressOverviewCsv(organizationId: string): Promise<{ csv: string; filename: string }> {
    const overview = await this.getEgressOverview(organizationId);
    const day = new Date().toISOString().slice(0, 10);
    return {
      csv: exportEgressOverviewCsv(overview.venues),
      filename: `egress-overview-${day}.csv`,
    };
  }

  async publishToEvent(eventId: string, organizationId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId },
      include: {
        venue: {
          include: {
            layouts: {
              where: { isActive: true },
              orderBy: { updatedAt: 'desc' },
              take: 1,
              include: {
                sections: {
                  orderBy: { sortOrder: 'asc' },
                  include: { seats: { include: { row: true } } },
                },
              },
            },
          },
        },
        seatMap: true,
        offers: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    const layout = event.venue.layouts[0];
    if (!layout?.sections.length) {
      throw new BadRequestException('El venue no tiene mapa con asientos. Guarda el layout primero.');
    }

    const snapshotData = this.layoutToMapData(layout);
    const totalSeats = snapshotData.sections.reduce((n, s) => n + s.seats.length, 0);
    if (totalSeats === 0) throw new BadRequestException('No hay asientos en el mapa');

    const tierPrices: Record<string, number> = {
      premium: Number(event.maxPrice) || Number(event.minPrice) * 1.5,
      standard: Number(event.minPrice) || 100,
      economy: Number(event.minPrice) * 0.7 || 50,
    };

    const result = await this.prisma.$transaction(async (tx) => {
      if (event.seatMap) {
        await tx.eventSeatMap.update({
          where: { id: event.seatMap.id },
          data: { snapshotData: snapshotData as object, layoutId: layout.id, publishedAt: new Date() },
        });
      } else {
        await tx.eventSeatMap.create({
          data: { eventId, layoutId: layout.id, snapshotData: snapshotData as object },
        });
      }

      await tx.ticket.deleteMany({
        where: { eventId, status: { in: [TicketStatus.AVAILABLE, TicketStatus.HELD] } },
      });

      // Los boletos que sobreviven al republicado (vendidos, usados, y ahora
      // también BLOCKED) siguen ocupando su butaca: `@@unique([eventId, seatId])`
      // rechazaría crear otra unidad para la misma. Se saltan.
      const survivors = await tx.ticket.findMany({
        where: { eventId, seatId: { not: null } },
        select: { seatId: true },
      });
      const occupiedSeatIds = new Set(survivors.map((t) => t.seatId as string));

      const offersBySection: Record<string, string> = {};
      const keepZones: string[] = [];

      for (const section of layout.sections) {
        const slug = section.slug;
        keepZones.push(slug);
        const tier = section.seats[0]?.tier ?? 'standard';
        const price = tierPrices[tier] ?? tierPrices.standard;
        const qty = section.seats.length;

        const offer = await tx.offer.upsert({
          where: { eventId_zone: { eventId, zone: slug } },
          create: {
            eventId,
            name: section.name,
            zone: slug,
            basePrice: new Decimal(price),
            totalQuantity: qty,
            remainingQuantity: qty,
            soldQuantity: 0,
            holdQuantity: 0,
            startDate: new Date(),
            endDate: event.startsAt,
            isAvailable: true,
          },
          update: {
            name: section.name,
            basePrice: new Decimal(price),
            totalQuantity: qty,
            remainingQuantity: qty,
            isAvailable: true,
          },
        });
        offersBySection[section.id] = offer.id;

        let created = 0;
        for (const seat of section.seats) {
          if (occupiedSeatIds.has(seat.id)) continue;
          await tx.ticket.create({
            data: {
              code: generateTicketCode(),
              eventId,
              offerId: offer.id,
              status: TicketStatus.AVAILABLE,
              seatId: seat.id,
              seatNumber: seat.label.includes('-') ? seat.label.split('-').pop() : seat.label,
              row: seat.row?.label ?? (seat.label.includes('-') ? seat.label.split('-')[0] : 'GA'),
              section: section.name,
            },
          });
          created += 1;
        }

        // `totalQuantity` es el aforo físico de la zona; lo que queda a la venta
        // no lo es si hay butacas vendidas o bloqueadas que sobrevivieron.
        if (created !== qty) {
          await tx.offer.update({
            where: { id: offer.id },
            data: { remainingQuantity: created },
          });
        }
      }

      // Hide orphan offers left from previous layouts (old a/b/c zones, etc.)
      await tx.offer.updateMany({
        where: {
          eventId,
          zone: { notIn: keepZones },
          isAvailable: true,
        },
        data: { isAvailable: false },
      });

      const updatedEvent = await tx.event.update({
        where: { id: eventId },
        data: {
          status: EventStatus.SCHEDULED,
          publishedAt: new Date(),
          totalCapacity: totalSeats,
          metadata: {
            ...((event.metadata as object) ?? {}),
            publishedWithLayout: layout.id,
            publishedAt: new Date().toISOString(),
          },
        },
      });

      return { event: updatedEvent, totalSeats, sections: layout.sections.length };
    });

    const meta = (event.metadata as Record<string, unknown>) ?? {};
    const channelAlloc = meta.channelAllocation ?? meta.channels;
    if (channelAlloc) {
      try {
        await this.channels.allocateInventoryToChannels(eventId, result.totalSeats);
      } catch (e) {
        this.logger.warn(`Channel inventory allocation skipped: ${(e as Error).message}`);
      }
    }

    this.logger.log(`Published event ${eventId}: ${result.totalSeats} tickets`);
    return result;
  }
}


