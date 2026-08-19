import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ProfecoDisclosureService } from './profeco-disclosure.service';

/**
 * Divulgación previa a la venta — cara PÚBLICA.
 *
 * Va sin guardas a propósito: de nada sirve una obligación de transparencia
 * cuya prueba exige iniciar sesión. Un comprador, un periodista o el propio
 * inspector de PROFECO tienen que poder leer esto sin credenciales.
 */
@ApiTags('Transparencia (PROFECO)')
@Controller('events/:eventId')
export class ProfecoDisclosurePublicController {
  constructor(private readonly disclosure: ProfecoDisclosureService) {}

  @Get('disclosure')
  @ApiOperation({
    summary: 'Divulgación previa a la venta: plano, asientos y precio total por sección',
  })
  async getDisclosure(@Param('eventId') eventId: string) {
    const record = await this.disclosure.getLatest(eventId);
    if (!record) {
      // 200 con `published: false` en vez de 404: que no se haya divulgado es
      // una respuesta legítima y verificable, no un error de la petición. Un
      // 404 se confundiría con «el evento no existe».
      return {
        published: false,
        message: 'Este evento aún no tiene divulgación previa publicada.',
      };
    }
    return {
      published: true,
      publishedAt: record.publishedAt.toISOString(),
      /** Permite a un tercero comprobar que el contenido no se alteró después. */
      contentHash: record.contentHash,
      ...record.payload,
    };
  }

  @Get('availability')
  @ApiOperation({
    summary: 'Disponibilidad real por sección, en vivo, durante toda la venta',
  })
  async getAvailability(@Param('eventId') eventId: string) {
    return await this.disclosure.availability(eventId);
  }
}

/**
 * Cara de gestión: publicar y comprobar antes de que sea tarde.
 */
@ApiTags('Transparencia (PROFECO)')
@Controller('events/manage/:eventId/disclosure')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ProfecoDisclosureAdminController {
  constructor(private readonly disclosure: ProfecoDisclosureService) {}

  @Get('preview')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Previsualizar la divulgación sin publicarla' })
  async preview(@Param('eventId') eventId: string) {
    return await this.disclosure.buildSnapshot(eventId);
  }

  @Get('compliance')
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: '¿Puede abrir la venta? Veredicto de cumplimiento' })
  async compliance(@Param('eventId') eventId: string) {
    return await this.disclosure.check(eventId);
  }

  @Post()
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Publicar la divulgación (arranca el reloj de 24 h)' })
  async publish(
    @Param('eventId') eventId: string,
    @CurrentUser('id') userId: string,
  ) {
    const record = await this.disclosure.publish(eventId, userId);
    return {
      id: record.id,
      publishedAt: record.publishedAt.toISOString(),
      contentHash: record.contentHash,
      capacity: record.capacity,
      applies: record.payload.regime.applies,
      earliestSaleAt: new Date(
        record.publishedAt.getTime() + record.payload.regime.leadHours * 3_600_000,
      ).toISOString(),
    };
  }
}
