import { Controller, Post, Get, Body, Param, UseGuards, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FraudService } from './fraud.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { EventOrgAccessGuard } from '../auth/event-org-access.guard';

/** Petición autenticada con el tenant ya resuelto por el guard de organización. */
type ScopedRequest = {
  user: { sub: string; email: string; role: string; organizationId?: string | null };
  scopedOrganizationId?: string | null;
};

/**
 * F2-11 — Todas las rutas de fraude son de inquilino.
 *
 * No hay RLS: `OrgAccessGuard` (o `EventOrgAccessGuard` donde el tenant se
 * deduce del evento) resuelve el inquilino y el servicio filtra por él. Ninguna
 * ruta de este controller puede quedar sin uno de los dos.
 */
@ApiTags('Fraud')
@Controller('fraud')
export class FraudController {
  constructor(private fraudService: FraudService) {}

  // ==================== ANALYZE FRAUD ====================

  /**
   * Era pública. Devolvía score, motivos y umbrales sobre `userId`/`buyerEmail`
   * arbitrarios: un oráculo con el que calibrar un ataque hasta quedar bajo el
   * umbral de BLOCK, y de paso un enumerador de cuentas (revelaba si un email
   * existía y si estaba verificado).
   *
   * El checkout NO la usaba: `orders.service` llama a `FraudService` en proceso,
   * así que cerrarla no rompe la venta. Queda para el panel del promotor,
   * exigiendo `eventId` para que `EventOrgAccessGuard` fije el inquilino.
   */
  @Post('analyze')
  @UseGuards(JwtAuthGuard, RolesGuard, EventOrgAccessGuard)
  @Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Analyze transaction for fraud (requires eventId)' })
  async analyzeFraud(
    @Body()
    dto: {
      orderId?: string;
      userId?: string;
      eventId: string;
      ipAddress?: string;
      deviceFingerprint?: string;
      buyerEmail?: string;
      amount?: number;
      currency?: string;
      channel?: string;
      paymentMethod?: string;
    },
  ) {
    return await this.fraudService.analyzeFraud(dto);
  }

  // ==================== CREATE FLAG ====================

  @Post('flags')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create fraud flag' })
  async createFlag(
    @Request() req: ScopedRequest,
    @Body()
    dto: {
      type: string;
      severity: string;
      reason: string;
      orderId?: string;
      userId?: string;
      eventId?: string;
      ipAddress?: string;
      deviceFingerprint?: string;
      metadata?: Record<string, any>;
    },
  ) {
    return await this.fraudService.createFlag(
      {
        ...dto,
        type: dto.type as any,
        severity: dto.severity as any,
        score: 0,
      },
      req.scopedOrganizationId,
    );
  }

  // ==================== LIST FLAGS ====================

  @Get('flags')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List fraud flags' })
  async listFlags(
    @Request() req: ScopedRequest,
    @Query('severity') severity?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return await this.fraudService.listFlags({
      severity: severity as any,
      status: status as any,
      limit,
      offset,
      // Autoridad del guard, nunca un `?organizationId=` del cliente.
      organizationId: req.scopedOrganizationId,
    });
  }

  // ==================== RESOLVE FLAG ====================

  @Post('flags/:flagId/resolve')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resolve fraud flag' })
  async resolveFlag(
    @Request() req: ScopedRequest,
    @Param('flagId') flagId: string,
    @Body() body: { resolution: string },
    @CurrentUser('sub') userId: string,
  ) {
    return await this.fraudService.resolveFlag(
      flagId,
      body.resolution,
      userId,
      req.scopedOrganizationId,
    );
  }

  // ==================== KYC CHECK ====================

  @Post('kyc/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Perform KYC check' })
  async performKYC(
    @Request() req: ScopedRequest,
    @Param('userId') userId: string,
    @Body()
    dto: {
      fullName: string;
      dateOfBirth: string;
      address: string;
      city: string;
      country: string;
      documentNumber: string;
      documentType: string;
    },
  ) {
    return await this.fraudService.performKYCCheck(userId, dto, req.scopedOrganizationId);
  }

  // ==================== AML CHECK ====================

  @Post('aml/:organizationId')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Perform AML check' })
  async performAML(
    @Param('organizationId') organizationId: string,
    @Body() dto: { name: string; country: string },
  ) {
    return await this.fraudService.performAMLCheck(organizationId, dto);
  }
}
