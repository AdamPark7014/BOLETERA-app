import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionKey } from '@boletera/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { MetricsService } from '../metrics/metrics.service';
import { TrackingLinksService } from './tracking-links.service';

type ScopedRequest = {
  user: { sub: string; role: string; organizationId?: string | null };
  scopedOrganizationId?: string | null;
};

@ApiTags('TrackingLinks')
@ApiBearerAuth()
@Controller('tracking-links')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, OrgAccessGuard)
@Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'MARKETING', 'VENUE_MANAGER')
@RequirePermissions(PermissionKey.REPORTS_READ)
export class TrackingLinksController {
  constructor(
    private readonly links: TrackingLinksService,
    private readonly metrics: MetricsService
  ) {}

  private org(req: ScopedRequest, organizationId?: string) {
    return this.metrics.resolveOrganizationId(
      req.scopedOrganizationId,
      req.user.organizationId,
      organizationId
    );
  }

  @Get()
  @ApiOperation({ summary: 'Listar enlaces de seguimiento de un evento' })
  list(
    @Request() req: ScopedRequest,
    @Query('eventId') eventId: string,
    @Query('organizationId') organizationId?: string
  ) {
    return this.links.list(this.org(req, organizationId), eventId);
  }

  @Post()
  @ApiOperation({ summary: 'Crear enlace ?ref=código' })
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'MARKETING')
  create(
    @Request() req: ScopedRequest,
    @Body() body: { eventId: string; code: string; label: string; organizationId?: string }
  ) {
    return this.links.create(
      this.org(req, body.organizationId),
      body.eventId,
      { code: body.code, label: body.label },
      req.user.sub
    );
  }

  @Get('report')
  @ApiOperation({ summary: 'Clics, órdenes e ingreso por enlace' })
  report(
    @Request() req: ScopedRequest,
    @Query('eventId') eventId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('organizationId') organizationId?: string
  ) {
    return this.links.report(this.org(req, organizationId), eventId, from, to);
  }

  @Delete(':code')
  @ApiOperation({ summary: 'Quitar un enlace de seguimiento' })
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'MARKETING')
  remove(
    @Request() req: ScopedRequest,
    @Param('code') code: string,
    @Query('eventId') eventId: string,
    @Query('organizationId') organizationId?: string
  ) {
    return this.links.remove(this.org(req, organizationId), eventId, code);
  }
}

@ApiTags('TrackingLinks')
@Controller('tracking-links')
export class TrackingLinksPublicController {
  constructor(private readonly links: TrackingLinksService) {}

  @Post('click')
  @ApiOperation({ summary: 'Registrar clic de un enlace ?ref=' })
  click(@Body() body: { eventId?: string; slug?: string; code?: string }) {
    return this.links.recordClick({
      eventId: body?.eventId,
      slug: body?.slug,
      code: body?.code,
    });
  }
}
