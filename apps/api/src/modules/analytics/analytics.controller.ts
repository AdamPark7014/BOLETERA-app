import { Controller, Post, Get, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { EventOrgAccessGuard } from '../auth/event-org-access.guard';

/**
 * F2-03 — Estas rutas exponen ingresos, liquidaciones, la lista de clientes con
 * sus datos personales y las señales de fraude. Antes bastaba con registrarse en
 * la web pública (sin verificación de correo) y pasar el `organizationId` de
 * cualquier promotor en la URL: había `JwtAuthGuard` pero nadie contrastaba el
 * tenant del path con el del token, y la ruta por `:eventId` no tenía guard
 * alguno.
 *
 * Ahora: rol mínimo de staff + aislamiento por organización en las cinco rutas.
 * Las guards de método se SUMAN a las de clase, así que cada ruta acaba con
 * JwtAuthGuard + RolesGuard + el guard de tenant que le corresponde.
 */
@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROMOTER', 'VENUE_MANAGER', 'ADMIN', 'SUPER_ADMIN')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  // ==================== DASHBOARDS ====================

  /** El tenant no viaja en el path: se deduce del evento y se coteja con el token. */
  @Get('events/:eventId/dashboard')
  @UseGuards(EventOrgAccessGuard)
  @ApiOperation({ summary: 'Get event analytics dashboard' })
  async getEventDashboard(@Param('eventId') eventId: string) {
    return await this.analyticsService.getEventDashboard(eventId);
  }

  @Get('promoters/:organizationId/dashboard')
  @UseGuards(OrgAccessGuard)
  @ApiOperation({ summary: 'Get promoter dashboard' })
  async getPromoterDashboard(
    @Param('organizationId') organizationId: string,
    @Query('period') period?: 'DAY' | 'WEEK' | 'MONTH',
  ) {
    return await this.analyticsService.getPromoterDashboard(organizationId, period);
  }

  // ==================== SETTLEMENT REPORTS ====================

  @Post('promoters/:organizationId/settlement')
  @UseGuards(OrgAccessGuard)
  @ApiOperation({ summary: 'Generate settlement report' })
  async generateSettlement(
    @Param('organizationId') organizationId: string,
    @Body() body: { month: number; year: number },
  ) {
    return await this.analyticsService.generateSettlementReport(organizationId, body.month, body.year);
  }

  // ==================== CUSTOMER ANALYTICS ====================

  @Get('promoters/:organizationId/customers')
  @UseGuards(OrgAccessGuard)
  @ApiOperation({ summary: 'Get customer analytics' })
  async getCustomerAnalytics(@Param('organizationId') organizationId: string) {
    return await this.analyticsService.getCustomerAnalytics(organizationId);
  }

  // ==================== FRAUD ANALYTICS ====================

  @Get('promoters/:organizationId/fraud')
  @UseGuards(OrgAccessGuard)
  @ApiOperation({ summary: 'Get fraud analytics' })
  async getFraudAnalytics(@Param('organizationId') organizationId: string) {
    return await this.analyticsService.getFraudAnalytics(organizationId);
  }
}
