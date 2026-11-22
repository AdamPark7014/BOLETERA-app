import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionKey } from '@boletera/shared';
import type { MetricsGranularity } from '@boletera/shared';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { EventAnalyticsService } from './event-analytics.service';
import { MetricsService } from './metrics.service';

type ScopedRequest = {
  user: { sub: string; role: string; organizationId?: string | null };
  scopedOrganizationId?: string | null;
};

type MetricsQuery = {
  from?: string;
  to?: string;
  organizationId?: string;
  eventId?: string;
};

@ApiTags('Metrics')
@ApiBearerAuth()
@Controller('metrics')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, OrgAccessGuard)
@Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER', 'FINANCE', 'MARKETING', 'AUDITOR')
@RequirePermissions(PermissionKey.REPORTS_READ)
export class MetricsController {
  constructor(
    private metrics: MetricsService,
    private readonly liveAnalytics: EventAnalyticsService
  ) {}

  private scope(req: ScopedRequest, query: MetricsQuery) {
    return this.metrics.resolveOrganizationId(
      req.scopedOrganizationId,
      req.user.organizationId,
      query.organizationId
    );
  }

  @Get('executive')
  @ApiOperation({ summary: 'Executive summary KPIs and revenue breakdown' })
  executive(@Request() req: ScopedRequest, @Query() query: MetricsQuery) {
    return this.metrics.executive({
      organizationId: this.scope(req, query),
      from: query.from,
      to: query.to,
      eventId: query.eventId,
    });
  }

  @Get('events/sales-pace')
  @ApiOperation({ summary: 'Event sell-through pace and risk' })
  salesPace(@Request() req: ScopedRequest, @Query() query: MetricsQuery) {
    return this.metrics.salesPace({
      organizationId: this.scope(req, query),
      from: query.from,
      to: query.to,
    });
  }

  @Get('events/:eventId/analytics')
  @ApiOperation({ summary: 'Analítica en vivo de un evento' })
  getEventLiveAnalytics(
    @Request() req: ScopedRequest,
    @Param('eventId') eventId: string,
    @Query() query: MetricsQuery
  ) {
    return this.liveAnalytics.getEventAnalytics({
      organizationId: this.scope(req, query),
      eventId,
      from: query.from,
      to: query.to,
    });
  }

  @Get('events/:eventId/analytics.csv')
  @ApiOperation({ summary: 'Exportar analítica del evento en CSV' })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async eventAnalyticsCsv(
    @Request() req: ScopedRequest,
    @Param('eventId') eventId: string,
    @Query() query: MetricsQuery,
    @Res() res: Response
  ) {
    const csv = await this.liveAnalytics.exportCsv(
      this.scope(req, query),
      eventId,
      query.from,
      query.to
    );
    res.setHeader('Content-Disposition', `attachment; filename="analitica-${eventId}.csv"`);
    res.send(csv);
  }

  @Patch('events/:eventId/sales-goal')
  @ApiOperation({ summary: 'Definir meta de venta del evento' })
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'MARKETING')
  setSalesGoal(
    @Request() req: ScopedRequest,
    @Param('eventId') eventId: string,
    @Body() body: { tickets?: number | null; revenue?: number | null },
    @Query() query: MetricsQuery
  ) {
    return this.liveAnalytics.setSalesGoal(this.scope(req, query), eventId, body ?? {});
  }

  @Get('inventory')
  @ApiOperation({ summary: 'Inventory availability and velocity' })
  inventory(@Request() req: ScopedRequest, @Query() query: MetricsQuery) {
    return this.metrics.inventory({
      organizationId: this.scope(req, query),
      from: query.from,
      to: query.to,
      eventId: query.eventId,
    });
  }

  @Get('orders')
  @ApiOperation({ summary: 'Orders and payments volume metrics' })
  orders(@Request() req: ScopedRequest, @Query() query: MetricsQuery) {
    return this.metrics.orders({
      organizationId: this.scope(req, query),
      from: query.from,
      to: query.to,
      eventId: query.eventId,
    });
  }

  @Get('access')
  @ApiOperation({ summary: 'Check-in and attendance metrics' })
  access(@Request() req: ScopedRequest, @Query() query: MetricsQuery) {
    return this.metrics.access({
      organizationId: this.scope(req, query),
      from: query.from,
      to: query.to,
      eventId: query.eventId,
    });
  }

  @Get('resale')
  @ApiOperation({ summary: 'Secondary market metrics' })
  resale(@Request() req: ScopedRequest, @Query() query: MetricsQuery) {
    return this.metrics.resale({
      organizationId: this.scope(req, query),
      from: query.from,
      to: query.to,
    });
  }

  @Get('waitlist')
  @ApiOperation({ summary: 'Waitlist funnel metrics' })
  waitlist(@Request() req: ScopedRequest, @Query() query: MetricsQuery) {
    return this.metrics.waitlist({
      organizationId: this.scope(req, query),
      from: query.from,
      to: query.to,
    });
  }

  @Get('campaigns')
  @ApiOperation({ summary: 'Promotion and campaign performance' })
  campaigns(@Request() req: ScopedRequest, @Query() query: MetricsQuery) {
    return this.metrics.campaigns({
      organizationId: this.scope(req, query),
      from: query.from,
      to: query.to,
    });
  }

  @Get('fraud')
  @ApiOperation({ summary: 'Fraud signal aggregates' })
  fraud(@Request() req: ScopedRequest, @Query() query: MetricsQuery) {
    return this.metrics.fraud({
      organizationId: this.scope(req, query),
      from: query.from,
      to: query.to,
    });
  }

  @Get('settlements')
  @ApiOperation({ summary: 'Settlement and payout metrics' })
  settlements(@Request() req: ScopedRequest, @Query() query: MetricsQuery) {
    return this.metrics.settlements({
      organizationId: this.scope(req, query),
      from: query.from,
      to: query.to,
    });
  }

  @Get('timeseries')
  @ApiOperation({ summary: 'Time-bucketed metric series' })
  timeseries(
    @Request() req: ScopedRequest,
    @Query() query: MetricsQuery & { granularity?: MetricsGranularity; metric?: string }
  ) {
    const metric = (query.metric ?? 'revenue') as
      | 'revenue'
      | 'orders'
      | 'tickets'
      | 'refunds'
      | 'checkins';
    return this.metrics.timeseries({
      organizationId: this.scope(req, query),
      from: query.from,
      to: query.to,
      eventId: query.eventId,
      granularity: query.granularity ?? 'day',
      metric,
    });
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Actionable operational alerts' })
  alerts(@Request() req: ScopedRequest, @Query() query: MetricsQuery) {
    return this.metrics.alerts({
      organizationId: this.scope(req, query),
      from: query.from,
      to: query.to,
    });
  }
}

/** Contador público de visitas a la ficha (sin sesión). */
@ApiTags('Metrics')
@Controller('metrics')
export class MetricsPublicController {
  constructor(private readonly liveAnalytics: EventAnalyticsService) {}

  @Post('visit')
  @ApiOperation({ summary: 'Registrar visita a la ficha de un evento' })
  visit(@Body() body: { eventId?: string; slug?: string }) {
    return this.liveAnalytics.recordVisit({
      eventId: body?.eventId,
      slug: body?.slug,
    });
  }
}
