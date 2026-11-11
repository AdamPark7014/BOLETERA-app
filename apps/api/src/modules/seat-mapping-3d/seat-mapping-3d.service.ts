import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import type { SeatMapData } from '@boletera/shared';
import {
  calculateSightlines,
  normalizeSeatMap,
  projectTo3D,
  resolveGeometry,
} from '@boletera/venue-engine';
import { PrismaService } from '../prisma/prisma.service';

export interface SeatPosition {
  id: string;
  label: string;
  section: string;
  row: string;
  seatNumber: number;
  x: number;
  y: number;
  z: number;
  tier: 'premium' | 'standard' | 'economy';
  visible: boolean;
  accessible: boolean;
  price: number;
  status: 'available' | 'held' | 'sold' | 'blocked';
  viewQuality?: number;
  sightlineGrade?: string;
}

export interface Section3D {
  id: string;
  name: string;
  color: string;
  seats: SeatPosition[];
  capacity: number;
  soldCount: number;
  price: number;
  geometry: {
    shape: 'rectangular' | 'curved' | 'circular';
    width: number;
    depth: number;
    rotation: number;
  };
}

@Injectable()
export class SeatMapping3DService {
  private logger = new Logger(SeatMapping3DService.name);

  constructor(private prisma: PrismaService) {}

  /** Load authored SeatMapData for a venue (active layout). */
  private async loadVenueMap(venueId: string): Promise<SeatMapData | null> {
    const layout = await this.prisma.venueLayout.findFirst({
      where: { venueId, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!layout?.mapData) return null;
    return normalizeSeatMap(layout.mapData);
  }

  /** Prefer published event snapshot; fall back to active venue layout. */
  private async loadEventMap(eventId: string): Promise<{
    map: SeatMapData;
    venueId: string;
    venueName: string;
  }> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        venue: true,
        seatMap: true,
      },
    });
    if (!event) throw new BadRequestException('Event not found');

    const raw =
      event.seatMap?.snapshotData ??
      (
        await this.prisma.venueLayout.findFirst({
          where: { venueId: event.venueId, isActive: true },
          orderBy: { updatedAt: 'desc' },
        })
      )?.mapData;

    if (!raw) throw new BadRequestException('No seat map published for this event/venue');

    return {
      map: normalizeSeatMap(raw),
      venueId: event.venueId,
      venueName: event.venue.name,
    };
  }

  private async ticketStatusMap(eventId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { eventId },
      select: { status: true, seatId: true },
    });
    const map = new Map<string, string>();
    for (const t of tickets) {
      if (t.seatId) map.set(t.seatId, String(t.status).toLowerCase());
    }
    return map;
  }

  private mapToSections3D(
    map: SeatMapData,
    ticketMap?: Map<string, string>,
    sightlineBySeat?: Map<string, { score: number; grade: string }>
  ): Section3D[] {
    const scene = resolveGeometry(map);
    const projected = projectTo3D(scene);
    const poseById = new Map(projected.seats.map((s) => [s.id, s]));

    return map.sections.map((sec, i) => {
      const seats: SeatPosition[] = sec.seats.map((s, idx) => {
        const numMatch = s.label.match(/(\d+)\s*$/);
        const pose = poseById.get(s.id);
        const sight = sightlineBySeat?.get(s.id);
        const statusRaw = ticketMap?.get(s.id) ?? 'available';
        const status = s.visibility?.blocked ? 'blocked' : (statusRaw as SeatPosition['status']);
        return {
          id: s.id,
          label: s.label,
          section: sec.name,
          row: s.row ?? 'A',
          seatNumber: numMatch ? parseInt(numMatch[1], 10) : idx + 1,
          x: pose?.px ?? s.x,
          y: pose?.py ?? s.elevation ?? 0,
          z: pose?.pz ?? s.y,
          tier: (s.tier as SeatPosition['tier']) || 'standard',
          visible: !s.visibility?.blocked,
          accessible: false,
          price: 0,
          status,
          viewQuality: sight?.score,
          sightlineGrade: sight?.grade,
        };
      });
      return {
        id: sec.id,
        name: sec.name,
        color: sec.color || '#4ecdc4',
        seats,
        capacity: seats.length,
        soldCount: seats.filter((s) => s.status === 'sold').length,
        price: this.calculateSectionPrice(i),
        geometry: {
          shape: 'rectangular' as const,
          width: 50,
          depth: 30,
          rotation: 0,
        },
      };
    });
  }

  // ==================== 3D VENUE GENERATION ====================

  async generateVenue3D(venueId: string) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new BadRequestException('Venue not found');

    const map = await this.loadVenueMap(venueId);
    if (!map || !map.sections.some((s) => s.seats.length)) {
      throw new BadRequestException(
        'Venue has no authored seat map. Open the map editor and apply a template first.'
      );
    }

    const scene = resolveGeometry(map);
    const sight = calculateSightlines(scene);
    const sightlineBySeat = new Map(sight.scores.map((s) => [s.seatId, s]));
    const sections = this.mapToSections3D(map, undefined, sightlineBySeat);

    return {
      venueId,
      venueName: venue.name,
      capacity: sections.reduce((n, s) => n + s.capacity, 0),
      type: 'layout',
      source: 'VenueGeometryEngine',
      sections,
      sightlines: sight.summary,
      metadata: {
        center: { x: 0, y: 0, z: 0 },
        scale: 1.0,
        lighting: 'professional',
        perspective: '3d',
        engine: 'v3',
      },
    };
  }

  private calculateSectionPrice(sectionIndex: number): number {
    if (sectionIndex === 0 || sectionIndex === 4) return 150;
    if (sectionIndex % 2 === 1) return 120;
    return 80;
  }

  // ==================== INTERACTIVE 3D VIEW ====================

  /**
   * Live inventory status for client-side 3D (web/admin project geometry locally).
   * Keeps a compatible envelope; does not re-run projectTo3D / sightlines on every poll.
   */
  async getInteractiveSeatView(eventId: string, selectedSeatId?: string) {
    const { map, venueName } = await this.loadEventMap(eventId);
    const ticketMap = await this.ticketStatusMap(eventId);

    const statusBySeat: Record<string, string> = {};
    const venue = map.sections.map((sec, i) => {
      const seats: SeatPosition[] = sec.seats.map((s, idx) => {
        const numMatch = s.label.match(/(\d+)\s*$/);
        const statusRaw = ticketMap.get(s.id) ?? 'available';
        const status: SeatPosition['status'] = s.visibility?.blocked
          ? 'blocked'
          : (statusRaw as SeatPosition['status']);
        statusBySeat[s.id] = status;
        return {
          id: s.id,
          label: s.label,
          section: sec.name,
          row: s.row ?? 'A',
          seatNumber: numMatch ? parseInt(numMatch[1], 10) : idx + 1,
          // Map-space placeholders — clients use published map + venue-3d for world poses
          x: s.x,
          y: s.elevation ?? 0,
          z: s.y,
          tier: (s.tier as SeatPosition['tier']) || 'standard',
          visible: !s.visibility?.blocked,
          accessible: false,
          price: 0,
          status,
        };
      });
      return {
        id: sec.id,
        name: sec.name,
        color: sec.color || '#4ecdc4',
        seats,
        capacity: seats.length,
        soldCount: seats.filter((s) => s.status === 'sold').length,
        price: this.calculateSectionPrice(i),
        geometry: {
          shape: 'rectangular' as const,
          width: 50,
          depth: 30,
          rotation: 0,
        },
      };
    });

    const selectedSeat = selectedSeatId
      ? (venue.flatMap((s) => s.seats).find((s) => s.id === selectedSeatId) ?? null)
      : null;

    this.logger.log(
      `Interactive status for ${venueName}: ${Object.keys(statusBySeat).length} seats (inventory)`
    );

    return {
      venue,
      statusBySeat,
      selectedSeat,
      camera: {
        position: { x: 0, y: -50, z: 200 },
        target: { x: 0, y: 0, z: 0 },
        fov: 60,
      },
      controls: {
        zoom: true,
        rotate: true,
        pan: true,
        keyboard: true,
      },
      source: 'inventory',
      geometrySource: 'client-VenueGeometryEngine',
    };
  }

  // ==================== SEAT RECOMMENDATION ====================

  async recommendSeats(
    eventId: string,
    preferences: {
      tier?: 'premium' | 'standard' | 'economy';
      count: number;
      accessible?: boolean;
      viewQuality?: 'best' | 'good' | 'any';
    }
  ) {
    const { map } = await this.loadEventMap(eventId);
    const ticketMap = await this.ticketStatusMap(eventId);
    const scene = resolveGeometry(map);
    const sight = calculateSightlines(scene);
    const scoreById = new Map(sight.scores.map((s) => [s.seatId, s]));

    const available = scene.seats.filter((s) => {
      const st = ticketMap.get(s.id) ?? 'available';
      if (st !== 'available') return false;
      if (s.visibility?.blocked) return false;
      if (preferences.tier && s.tier && s.tier !== preferences.tier) return false;
      const grade = scoreById.get(s.id)?.grade;
      if (preferences.viewQuality === 'best' && grade !== 'premium' && grade !== 'good')
        return false;
      if (preferences.viewQuality === 'good' && (grade === 'restricted' || grade === 'blocked')) {
        return false;
      }
      return true;
    });

    const scored = available
      .map((seat) => ({
        seat,
        score: scoreById.get(seat.id)?.score ?? 0,
        grade: scoreById.get(seat.id)?.grade ?? 'fair',
      }))
      .sort((a, b) => b.score - a.score);

    const recommended = scored.slice(0, preferences.count).map(({ seat, score, grade }) => ({
      id: seat.id,
      label: seat.label,
      section: seat.sectionName,
      row: seat.row,
      x: seat.x,
      y: seat.elevation,
      z: seat.y,
      tier: seat.tier,
      viewQuality: grade,
      sightlineScore: score,
      status: 'available' as const,
    }));

    this.logger.log(`Recommended ${recommended.length} seats for event ${eventId} via sightlines`);

    return {
      recommended,
      totalAvailable: available.length,
      viewQuality: preferences.viewQuality ?? 'any',
      confidence: Math.min(recommended.length / Math.max(preferences.count, 1), 1.0),
      sightlines: sight.summary,
      source: 'VenueGeometryEngine',
    };
  }

  // ==================== HEAT MAP (OCCUPANCY) ====================

  async getOccupancyHeatmap(eventId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { eventId },
      select: { status: true, seatId: true },
    });

    const occupancy = {
      total: tickets.length,
      sold: tickets.filter((t) => t.status === 'SOLD').length,
      held: tickets.filter((t) => t.status === 'HELD').length,
      available: tickets.filter((t) => t.status === 'AVAILABLE').length,
      refunded: tickets.filter((t) => t.status === 'REFUNDED').length,
    };

    const occupancyPercent =
      occupancy.total > 0 ? Math.round((occupancy.sold / occupancy.total) * 100) : 0;

    return {
      eventId,
      occupancy,
      occupancyPercent,
      recommendation: this.getOccupancyRecommendation(occupancyPercent),
      source: 'inventory',
    };
  }

  private getOccupancyRecommendation(percent: number): string {
    if (percent < 20) return 'Lots of inventory available';
    if (percent < 50) return 'Good availability';
    if (percent < 80) return 'Limited seats remaining';
    return 'Almost sold out';
  }
}
