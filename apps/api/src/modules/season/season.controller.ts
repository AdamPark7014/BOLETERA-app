import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { SeasonService, type SeasonPassWrite } from './season.service';

@ApiTags('Season / Abonos')
@Controller('season')
export class SeasonController {
  constructor(private season: SeasonService) {}

  @Post('purchase/:seasonPassId')
  @ApiOperation({ summary: 'Purchase season pass (demo completes immediately)' })
  purchase(
    @Param('seasonPassId') seasonPassId: string,
    @Body()
    body: { buyerEmail: string; buyerName: string; quantity?: number; seatSection?: string },
  ) {
    return this.season.purchase(seasonPassId, body);
  }

  @Post('org/:orgId')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create season pass / abono' })
  create(
    @Param('orgId') orgId: string,
    @Body()
    body: {
      name: string;
      slug: string;
      description?: string;
      seasonLabel: string;
      startsAt: string;
      endsAt: string;
      price: number;
      venueId?: string;
      maxQuantity?: number;
      eventIds?: string[];
    },
  ) {
    return this.season.create(orgId, body);
  }

  @Get('org/:orgId')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiBearerAuth()
  list(@Param('orgId') orgId: string) {
    return this.season.list(orgId);
  }

  @Patch('org/:orgId/:passId')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update season pass / abono' })
  update(
    @Param('orgId') orgId: string,
    @Param('passId') passId: string,
    @Body() body: SeasonPassWrite,
    @Request() req: { user?: { sub?: string } },
  ) {
    return this.season.update(orgId, passId, body, req.user?.sub);
  }
}
