import { Controller, Get, Header, Param, Query, Request, Sse, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { EventOrgAccessGuard } from '../auth/event-org-access.guard';
import { AllowStreamTicket, StreamAuthGuard } from '../auth/stream-auth.guard';
import { ReportingService } from './reporting.service';

/** Petición autenticada con el tenant ya resuelto por el guard de organización. */
type ScopedRequest = {
  user: { sub: string; email: string; role: string; organizationId?: string | null };
  scopedOrganizationId?: string | null;
};

/**
 * F2-10 — Los guards de organización pasan a ser POR RUTA.
 *
 * `OrgAccessGuard` a nivel de clase no valía para las rutas por evento
 * (`/heatmap/:eventId`, `/predict/:eventId`): al no llegar `organizationId` en
 * la petición, el guard resolvía el tenant del token y daba por bueno el
 * `eventId`, fuera de quien fuera. Cualquier promotor leía la ocupación y la
 * previsión de venta de los eventos de otro con sólo su id. Esas rutas llevan
 * ahora `EventOrgAccessGuard`, que resuelve el dueño del evento y lo contrasta.
 *
 * La autenticación de clase es `StreamAuthGuard` (superconjunto de
 * `JwtAuthGuard`) porque la ruta SSE no puede mandar cabeceras; ver F2-12 en
 * `auth/stream-ticket.service.ts`.
 */
@ApiTags('Reporting & Analytics')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(StreamAuthGuard, RolesGuard)
@Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
export class ReportingController {
  constructor(private reportingService: ReportingService) {}

  @Get('dashboard/realtime/:organizationId')
  @UseGuards(OrgAccessGuard)
  @ApiOperation({ summary: 'Get real-time dashboard' })
  async getRealtimeDashboard(
    @Request() req: ScopedRequest,
    @Param('organizationId') orgId: string,
    @Query('eventId') eventId?: string,
  ) {
    return await this.reportingService.getRealtimeDashboard(
      req.scopedOrganizationId ?? orgId,
      eventId,
    );
  }

  /**
   * F2-12 — Único punto de la API que acepta credencial por query, y sólo un
   * ticket de SSE de vida corta (nunca el JWT de sesión). `OrgAccessGuard`
   * sigue detrás: el ticket autentica, no autoriza el tenant.
   */
  @Sse('dashboard/realtime/:organizationId/stream')
  @UseGuards(OrgAccessGuard)
  @AllowStreamTicket()
  @ApiQuery({
    name: 'ticket',
    required: false,
    description: 'Ticket de POST /auth/stream-ticket (EventSource no manda cabeceras)',
  })
  @ApiOperation({ summary: 'SSE stream for realtime dashboard (10s)' })
  streamRealtime(
    @Request() req: ScopedRequest,
    @Param('organizationId') orgId: string,
    @Query('eventId') eventId?: string,
  ) {
    return this.reportingService.streamRealtimeDashboard(
      req.scopedOrganizationId ?? orgId,
      eventId,
    );
  }

  @Get('settlement/:organizationId/:period')
  @UseGuards(OrgAccessGuard)
  @ApiOperation({ summary: 'Generate settlement report' })
  async getSettlement(
    @Request() req: ScopedRequest,
    @Param('organizationId') orgId: string,
    @Param('period') period: 'DAILY' | 'WEEKLY' | 'MONTHLY',
  ) {
    return await this.reportingService.generateSettlementReport(
      req.scopedOrganizationId ?? orgId,
      period,
    );
  }

  @Get('heatmap/:eventId')
  @UseGuards(EventOrgAccessGuard)
  @ApiOperation({ summary: 'Get occupancy heatmap' })
  async getHeatmap(@Param('eventId') eventId: string) {
    return await this.reportingService.getOccupancyHeatmap(eventId);
  }

  @Get('predict/:eventId')
  @UseGuards(EventOrgAccessGuard)
  @ApiOperation({ summary: 'Get occupancy prediction' })
  async predictOccupancy(@Param('eventId') eventId: string) {
    return await this.reportingService.predictOccupancy(eventId);
  }

  @Get('channels/:organizationId')
  @UseGuards(OrgAccessGuard)
  @ApiOperation({ summary: 'Get channel performance' })
  async getChannelPerformance(
    @Request() req: ScopedRequest,
    @Param('organizationId') orgId: string,
  ) {
    return await this.reportingService.getChannelPerformance(req.scopedOrganizationId ?? orgId);
  }

  @Get('customers/:organizationId')
  @UseGuards(OrgAccessGuard)
  @ApiOperation({ summary: 'Get customer analytics' })
  async getCustomerAnalytics(
    @Request() req: ScopedRequest,
    @Param('organizationId') orgId: string,
  ) {
    return await this.reportingService.getCustomerAnalytics(req.scopedOrganizationId ?? orgId);
  }

  @Get('export/sales/:organizationId')
  @UseGuards(OrgAccessGuard)
  @Header('Content-Type', 'text/csv')
  @ApiOperation({ summary: 'Export completed sales as CSV' })
  async exportSales(
    @Request() req: ScopedRequest,
    @Param('organizationId') orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const result = await this.reportingService.exportSalesCsv(
      req.scopedOrganizationId ?? orgId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
    return result.csv;
  }

  @Get('forecast/:organizationId/:days')
  @UseGuards(OrgAccessGuard)
  @ApiOperation({ summary: 'Get revenue forecast' })
  async getRevenueForecast(
    @Request() req: ScopedRequest,
    @Param('organizationId') orgId: string,
    @Param('days') days: string,
  ) {
    return await this.reportingService.generateRevenueForecast(
      req.scopedOrganizationId ?? orgId,
      parseInt(days, 10),
    );
  }
}
