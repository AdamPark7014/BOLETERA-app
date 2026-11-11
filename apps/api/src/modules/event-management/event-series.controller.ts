import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  EventSeriesService,
  type ExtendInput,
  type PreviewInput,
  type SeriesPatch,
} from './event-series.service';

/**
 * Series y vista previa de recurrencia para el panel (`apps/admin/lib/scheduling-api`).
 * Mismas guardas que `events/manage`; todo se acota a la organización del usuario.
 */
@ApiTags('Event Management')
@Controller('events/schedule')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class EventSeriesController {
  constructor(private series: EventSeriesService) {}

  @Get('series')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Series y residencias de la organización' })
  async listSeries(@CurrentUser('organizationId') orgId: string) {
    return await this.series.listSeries(orgId);
  }

  @Get('series/:seriesId')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Detalle de una serie con sus fechas' })
  async getSeries(
    @CurrentUser('organizationId') orgId: string,
    @Param('seriesId') seriesId: string
  ) {
    return await this.series.getSeries(orgId, seriesId);
  }

  @Patch('series/:seriesId')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Cambiar nombre, descripción o estado de la serie' })
  async updateSeries(
    @CurrentUser('organizationId') orgId: string,
    @Param('seriesId') seriesId: string,
    @Body() body: SeriesPatch
  ) {
    return await this.series.updateSeries(orgId, seriesId, body);
  }

  @Post('series/:seriesId/extend')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Agregar fechas con la regla y plantilla guardadas' })
  async extendSeries(
    @CurrentUser('organizationId') orgId: string,
    @Param('seriesId') seriesId: string,
    @Body() body: ExtendInput
  ) {
    return await this.series.extendSeries(orgId, seriesId, body);
  }

  @Post('preview')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Vista previa de recurrencia (no escribe nada)' })
  async preview(@CurrentUser('organizationId') orgId: string, @Body() body: PreviewInput) {
    return await this.series.previewSchedule(orgId, body);
  }
}
