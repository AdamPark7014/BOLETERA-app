import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { WaitlistService } from './waitlist.service';

@ApiTags('Waitlist')
@Controller('waitlist')
export class WaitlistController {
  constructor(private waitlist: WaitlistService) {}

  @Post('join')
  join(
    @Body()
    body: {
      eventId: string;
      email: string;
      phone?: string;
      firstName?: string;
      lastName?: string;
      quantity?: number;
      offerId?: string;
    }
  ) {
    return this.waitlist.join(body);
  }

  @Get('event/:eventId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  listEvent(@Param('eventId') eventId: string, @Query('status') status?: string) {
    return this.waitlist.listByEvent(eventId, status);
  }

  @Get('organization/:orgId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  listOrg(@Param('orgId') orgId: string) {
    return this.waitlist.listByOrganization(orgId);
  }

  @Get('event/:eventId/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  stats(@Param('eventId') eventId: string) {
    return this.waitlist.stats(eventId);
  }

  @Post('event/:eventId/notify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  notify(@Param('eventId') eventId: string, @Query('limit') limit?: string) {
    return this.waitlist.notifyBatch(eventId, limit ? parseInt(limit, 10) : 50);
  }
}
