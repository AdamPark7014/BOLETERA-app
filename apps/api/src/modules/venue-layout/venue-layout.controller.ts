import { Body, Controller, Get, Header, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { SeatMapData, SeatMapSection } from '@boletera/shared';
import { PermissionKey } from '@boletera/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { EventPublishValidationService } from '../event-management/event-publish-validation.service';
import { VenueLayoutService } from './venue-layout.service';

@ApiTags('Venue Layout / Map Editor')
@Controller('venues')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class VenueLayoutController {
  constructor(private layoutService: VenueLayoutService) {}

  /** Static path — must be registered before `:venueId` routes. */
  @Get('egress-overview')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Org-wide egress health summary (all venues)' })
  getEgressOverview(@CurrentUser('organizationId') orgId: string) {
    return this.layoutService.getEgressOverview(orgId);
  }

  @Get('egress-overview.csv')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'Org-wide egress health summary (CSV download)' })
  async getEgressOverviewCsv(
    @CurrentUser('organizationId') orgId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.layoutService.exportEgressOverviewCsv(orgId);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return result.csv;
  }

  @Get(':venueId/layout')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Get active venue layout + seat map' })
  getLayout(@Param('venueId') venueId: string, @CurrentUser('organizationId') orgId: string) {
    return this.layoutService.getActiveLayout(venueId, orgId);
  }

  @Get(':venueId/layout/egress')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Egress / circulation report (JSON) for active layout' })
  async getEgressJson(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
  ) {
    return this.layoutService.getEgressReport(venueId, orgId, { format: 'json' });
  }

  @Get(':venueId/layout/egress.csv')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'Egress / circulation report (CSV download)' })
  async getEgressCsv(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.layoutService.getEgressReport(venueId, orgId, { format: 'csv' });
    if (result.format !== 'csv') {
      throw new Error('Expected CSV egress report');
    }
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return result.csv;
  }

  @Get(':venueId/layout/egress.pdf')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'Egress / circulation report (PDF download)' })
  async getEgressPdf(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.layoutService.getEgressReport(venueId, orgId, { format: 'pdf' });
    if (result.format !== 'pdf') {
      throw new Error('Expected PDF egress report');
    }
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return result.pdf;
  }

  @Post(':venueId/layout/egress')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({
    summary: 'Analyze egress for saved layout or unsaved mapData draft (json|csv|pdf)',
  })
  async postEgress(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { mapData?: SeatMapData; format?: 'json' | 'csv' | 'pdf' } = {},
    @Query('format') formatQuery?: 'json' | 'csv' | 'pdf',
  ) {
    const format = body.format ?? formatQuery ?? 'json';
    const result = await this.layoutService.getEgressReport(venueId, orgId, {
      mapData: body.mapData,
      format,
    });
    if (result.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.csv;
    }
    if (result.format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return result.pdf;
    }
    return result;
  }

  @Put(':venueId/layout')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Save seat map (syncs sections/seats to DB)' })
  saveLayout(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
    @Body() body: SeatMapData & { mapData?: SeatMapData },
  ) {
    const mapData = body.mapData ?? body;
    return this.layoutService.saveMap(venueId, orgId, mapData);
  }

  @Post(':venueId/layout/from-template')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Replace layout from template (arena/theater/stadium/festival)' })
  fromTemplate(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
    @Body()
    body: {
      template: 'arena' | 'theater' | 'stadium' | 'festival';
      capacity?: number;
      sectionCount?: number;
    },
  ) {
    return this.layoutService.applyTemplate(venueId, orgId, body.template, {
      capacity: body.capacity,
      sectionCount: body.sectionCount,
    });
  }

  @Post(':venueId/layout/ai-import')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Import AI-suggested sections into layout' })
  aiImport(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
    @Body() body: { sections: SeatMapSection[] },
  ) {
    return this.layoutService.importAiSections(venueId, orgId, body.sections);
  }

  @Post(':venueId/layout/suggest')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Generate layout from natural-language prompt via templates' })
  suggest(
    @Param('venueId') venueId: string,
    @CurrentUser('organizationId') orgId: string,
    @Body() body: { prompt: string },
  ) {
    return this.layoutService.suggestFromPrompt(venueId, orgId, body.prompt || '');
  }

  @Get(':venueId/layout/workflow')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Layout publish status, sales lock, version snapshots' })
  getWorkflow(@Param('venueId') venueId: string, @CurrentUser('organizationId') orgId: string) {
    return this.layoutService.getWorkflow(venueId, orgId);
  }

  @Post(':venueId/layout/submit-review')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Submit layout for review (Draft → Review)' })
  submitReview(
    @Param('venueId') venueId: string,
    @CurrentUser() user: { sub: string; organizationId: string },
  ) {
    return this.layoutService.submitForReview(venueId, user.organizationId, user.sub);
  }

  @Post(':venueId/layout/revert-draft')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Return layout to draft (Review → Draft)' })
  revertDraft(
    @Param('venueId') venueId: string,
    @CurrentUser() user: { sub: string; organizationId: string },
  ) {
    return this.layoutService.revertToDraft(venueId, user.organizationId, user.sub);
  }

  @Post(':venueId/layout/publish-map')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Publish venue layout after geometry validation' })
  publishMap(
    @Param('venueId') venueId: string,
    @CurrentUser() user: { sub: string; organizationId: string },
  ) {
    return this.layoutService.publishLayout(venueId, user.organizationId, user.sub);
  }

  @Post(':venueId/layout/archive')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Archive published layout (Published → Archived)' })
  archiveLayout(
    @Param('venueId') venueId: string,
    @CurrentUser() user: { sub: string; organizationId: string },
  ) {
    return this.layoutService.archiveLayout(venueId, user.organizationId, user.sub);
  }

  @Post(':venueId/layout/rollback/:snapshotId')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Restore layout from version snapshot' })
  rollbackSnapshot(
    @Param('venueId') venueId: string,
    @Param('snapshotId') snapshotId: string,
    @CurrentUser() user: { sub: string; organizationId: string },
  ) {
    return this.layoutService.rollbackToSnapshot(
      venueId,
      user.organizationId,
      snapshotId,
      user.sub,
    );
  }
}

@ApiTags('Event Publishing')
@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@ApiBearerAuth()
export class EventPublishController {
  constructor(
    private layoutService: VenueLayoutService,
    private publishValidation: EventPublishValidationService,
  ) {}

  @Post(':eventId/publish')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @RequirePermissions(PermissionKey.EVENTS_PUBLISH)
  @ApiOperation({ summary: 'Publish event: map snapshot + offers + tickets + channels' })
  async publish(@Param('eventId') eventId: string, @CurrentUser('organizationId') orgId: string) {
    await this.publishValidation.assertReadyForPublish(eventId, orgId);
    return this.layoutService.publishToEvent(eventId, orgId);
  }
}


