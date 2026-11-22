import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AccessService } from './access.service';

/** Roles que operan una puerta o una ventanilla. */
const GATE_ROLES = ['SCANNER', 'TAQUILLA', 'ADMIN', 'SUPER_ADMIN'] as const;

type JwtUser = { sub: string; email?: string; role?: string; organizationId?: string | null };

@ApiTags('Access')
@Controller('access')
export class AccessController {
  constructor(private access: AccessService) {}

  @Post('scan')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...GATE_ROLES)
  @ApiBearerAuth()
  scan(
    @Request() req: { user: JwtUser },
    @Body()
    body: {
      ticketCode?: string;
      qrPayload?: string;
      zoneId?: string;
      channel?: string;
      eventId?: string;
      /** ENTRY (omisión) o EXIT para registrar salida. */
      mode?: string;
    }
  ) {
    // Los campos se copian uno a uno a propósito. Antes se hacía `...body`, así
    // que el cuerpo podía traer su propio `scannedBy` y la trazabilidad de quién
    // escaneó era falsificable (F2-14): ahora sale del token y punto.
    return this.access.scanTicket({
      ticketCode: body.ticketCode,
      qrPayload: body.qrPayload,
      zoneId: body.zoneId,
      scannedBy: req.user.sub,
      channel: body.channel ?? 'TAQUILLA',
      eventId: typeof body.eventId === 'string' && body.eventId ? body.eventId : undefined,
      scannerOrganizationId: req.user.organizationId ?? null,
      scannerRole: req.user.role,
      mode: body.mode?.toUpperCase() === 'EXIT' ? 'EXIT' : 'ENTRY',
    });
  }

  @Get('tickets/:id/qr')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  qr(
    @Request() req: { user: JwtUser; ip?: string },
    @Param('id') id: string,
    @Query('reason') reason?: string
  ) {
    // El servicio decide si es el titular o una reimpresión de ventanilla; el
    // controller solo entrega la identidad del token, nunca datos del cuerpo (F2-04).
    return this.access.getQrForTicket(id, req.user, { reason, ipAddress: req.ip });
  }

  /** Totales en vivo de la función: entraron, faltan, aforo dentro, por puerta y por minuto. */
  @Get('events/:eventId/live')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...GATE_ROLES)
  @ApiBearerAuth()
  live(@Request() req: { user: JwtUser }, @Param('eventId') eventId: string) {
    return this.access.getLiveStats(eventId, {
      organizationId: req.user.organizationId ?? null,
      role: req.user.role,
    });
  }

  /** Búsqueda manual por nombre, correo o folio (quien no trae el teléfono). */
  @Get('events/:eventId/lookup')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...GATE_ROLES)
  @ApiBearerAuth()
  lookup(
    @Request() req: { user: JwtUser },
    @Param('eventId') eventId: string,
    @Query('q') q?: string
  ) {
    return this.access.searchTickets(eventId, q ?? '', {
      organizationId: req.user.organizationId ?? null,
      role: req.user.role,
    });
  }

  /** Admite o registra salida tras confirmar la identidad a mano. */
  @Post('events/:eventId/manual-admit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...GATE_ROLES)
  @ApiBearerAuth()
  manualAdmit(
    @Request() req: { user: JwtUser },
    @Param('eventId') eventId: string,
    @Body()
    body: {
      ticketId: string;
      confirmedName: string;
      zoneId?: string;
      channel?: string;
      mode?: string;
    }
  ) {
    return this.access.confirmManualAdmit({
      eventId,
      ticketId: body.ticketId,
      confirmedName: body.confirmedName,
      zoneId: body.zoneId,
      scannedBy: req.user.sub,
      channel: body.channel ?? 'TAQUILLA',
      scannerOrganizationId: req.user.organizationId ?? null,
      scannerRole: req.user.role,
      mode: body.mode?.toUpperCase() === 'EXIT' ? 'EXIT' : 'ENTRY',
    });
  }

  /** Manifiesto del evento para verificación en puerta sin red (F2-15). */
  @Get('events/:eventId/manifest')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...GATE_ROLES)
  @ApiBearerAuth()
  manifest(
    @Param('eventId') eventId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    return this.access.getEventManifest(eventId, {
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** Conciliación de un lote de escaneos hechos durante un corte de red (F2-15). */
  @Post('scans/sync')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...GATE_ROLES)
  @ApiBearerAuth()
  syncScans(
    @Request() req: { user: JwtUser },
    @Body()
    body: {
      channel?: string;
      scans: { ticketId: string; scannedAt?: string; zoneId?: string; mode?: string }[];
    }
  ) {
    return this.access.syncOfflineScans({
      scannedBy: req.user.sub,
      channel: body.channel ?? 'TAQUILLA',
      scans: body.scans,
    });
  }
}
