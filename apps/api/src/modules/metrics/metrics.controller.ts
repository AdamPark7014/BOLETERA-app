import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionKey } from '@boletera/shared';
import type { MetricsGranularity } from '@boletera/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
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
  constructor(private metrics: MetricsService) {}

  private scope(req: ScopedRequest, query: MetricsQuery) {
    return this.metrics.resolveOrganizationId(
      req.scopedOrganizationId,
      req.user.organizationId,
      query.organizationId,
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
    @Query() query: MetricsQuery & { granularity?: MetricsGranularity; metric?: string },
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
