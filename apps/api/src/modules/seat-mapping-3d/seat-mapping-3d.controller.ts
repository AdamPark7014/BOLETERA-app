import { Controller, Get, Post, Param, Query, UseGuards, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SeatMapping3DService } from './seat-mapping-3d.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('3D Seat Mapping')
@Controller('3d')
export class SeatMapping3DController {
  constructor(private seatMappingService: SeatMapping3DService) {}

  // ==================== VENUE 3D GENERATION ====================

  @Get('venue/:venueId')
  @ApiOperation({
    summary: 'Generate 3D venue map (compat)',
    deprecated: true,
    description:
      'Prefer published SeatMapData + client @boletera/venue-3d. Still powered by VenueGeometryEngine.',
  })
  async generateVenue3D(@Param('venueId') venueId: string) {
    return await this.seatMappingService.generateVenue3D(venueId);
  }

  // ==================== INTERACTIVE 3D VIEW ====================

  @Get('events/:eventId/interactive')
  @ApiOperation({
    summary: 'Live seat status for 3D clients',
    description:
      'Returns statusBySeat (+ compatible venue envelope). Geometry is projected client-side from the published map.',
  })
  async getInteractiveSeatView(
    @Param('eventId') eventId: string,
    @Query('selectedSeat') selectedSeatId?: string
  ) {
    return await this.seatMappingService.getInteractiveSeatView(eventId, selectedSeatId);
  }

  // ==================== AI RECOMMENDATIONS ====================

  @Post('events/:eventId/recommendations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Heuristic seat recommendations (sightline / preference scores)' })
  async recommendSeats(
    @Param('eventId') eventId: string,
    @Body()
    preferences: {
      tier?: 'premium' | 'standard' | 'economy';
      count: number;
      accessible?: boolean;
      viewQuality?: 'best' | 'good' | 'any';
    }
  ) {
    return await this.seatMappingService.recommendSeats(eventId, preferences);
  }

  // ==================== OCCUPANCY HEATMAP ====================

  @Get('events/:eventId/heatmap')
  @ApiOperation({ summary: 'Get real-time occupancy heatmap' })
  async getOccupancyHeatmap(@Param('eventId') eventId: string) {
    return await this.seatMappingService.getOccupancyHeatmap(eventId);
  }
}
