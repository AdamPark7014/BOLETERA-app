import { Controller, Get, Param, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgAccessGuard, type OrgScopedRequest } from '../auth/org-access.guard';
import { AiService, type AiQuery } from './ai.service';

/**
 * Rutas `/ai/*` del panel. Pese al nombre, NO llaman a ningún modelo de
 * lenguaje: son agregados, reglas estadísticas y plantillas sobre datos reales
 * (ver ai-insights.ts). Mismas guardas que analytics: rol de staff +
 * aislamiento por organización (`OrgAccessGuard` publica el inquilino).
 */
@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
@Roles('PROMOTER', 'VENUE_MANAGER', 'ADMIN', 'SUPER_ADMIN')
export class AiController {
  constructor(private ai: AiService) {}

  @Get('summaries/executive')
  @ApiOperation({ summary: 'Resumen ejecutivo determinista (plantillas sobre KPIs)' })
  executive(@Request() req: OrgScopedRequest, @Query() query: AiQuery) {
    return this.ai.executiveSummary(req.scopedOrganizationId, query);
  }

  @Get('anomalies')
  @ApiOperation({ summary: 'Anomalías diarias por puntaje z contra media móvil de 7 días' })
  anomalies(@Request() req: OrgScopedRequest, @Query() query: AiQuery) {
    return this.ai.anomalies(req.scopedOrganizationId, query);
  }

  @Get('recommendations')
  @ApiOperation({ summary: 'Recomendaciones por reglas fijas' })
  recommendations(@Request() req: OrgScopedRequest, @Query() query: AiQuery) {
    return this.ai.recommendations(req.scopedOrganizationId, query);
  }

  @Get('fraud/risk')
  @ApiOperation({ summary: 'Riesgo de fraude a partir de las señales abiertas' })
  fraudRisk(@Request() req: OrgScopedRequest, @Query() query: AiQuery) {
    return this.ai.fraudRisk(req.scopedOrganizationId, query);
  }

  @Get('segmentation/customers')
  @ApiOperation({ summary: 'Segmentación RFM de clientes con órdenes completadas' })
  segmentation(@Request() req: OrgScopedRequest, @Query() query: AiQuery) {
    return this.ai.segmentation(req.scopedOrganizationId, query);
  }

  @Get('forecast/events/:eventId')
  @ApiOperation({ summary: 'Pronóstico lineal del ritmo de venta de un evento' })
  forecast(@Request() req: OrgScopedRequest, @Param('eventId') eventId: string) {
    return this.ai.forecast(req.scopedOrganizationId, eventId);
  }
}
