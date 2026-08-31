import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  Logger,
  Query,
  Request,
  UseGuards,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { RefundStatus } from '@prisma/client';
import { timingSafeEqualString } from '@boletera/payments';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrgAccessGuard, type OrgScopedRequest } from '../auth/org-access.guard';
import { requireInternalApiSecret } from '../auth/jwt-secret';
import { BanorteReconciliationService } from './banorte-reconciliation.service';
import { EventCancellationService } from './event-cancellation.service';
import { PaymentService } from './payment.service';

/** Petición ya resuelta por `OrgAccessGuard`: `scopedOrganizationId` es el tenant efectivo. */
type ScopedRequest = OrgScopedRequest & { user?: { role?: string } };

/**
 * Tenant efectivo de una lectura de operación.
 *
 * `OrgAccessGuard` deja `scopedOrganizationId` en `null` únicamente para
 * SUPER_ADMIN sin organización en el token (rol de plataforma): ese es el único
 * caso en el que una consulta puede atravesar organizaciones. Se vuelve a
 * comprobar aquí para que un cambio futuro en el guard no abra la base entera.
 */
function requireScope(req: ScopedRequest): string | null {
  const scoped = req.scopedOrganizationId ?? null;
  if (scoped) return scoped;
  if (req.user?.role === 'SUPER_ADMIN') return null;
  throw new BadRequestException('organizationId requerido');
}

function parseRefundStatus(raw?: string): RefundStatus | undefined {
  if (!raw) return undefined;
  const value = raw.toUpperCase() as RefundStatus;
  if (!Object.values(RefundStatus).includes(value)) {
    throw new BadRequestException(`status inválido: ${raw}`);
  }
  return value;
}

@ApiTags('Payments')
@Controller('payments')
export class PaymentController {
  private logger = new Logger(PaymentController.name);

  constructor(
    private paymentService: PaymentService,
    private reconciliation: BanorteReconciliationService,
    private cancellations: EventCancellationService,
  ) {}

  /**
   * Cancelación de evento con las devoluciones que exige la LFPC art. 92 Bis.
   *
   * `dryRun: true` (por defecto) proyecta el impacto sin mover un peso: cuántas
   * órdenes, cuánto se devuelve y cuánta bonificación sale. Cancelar un evento
   * es irreversible y mueve todo el dinero de un aforo, así que ejecutar exige
   * pedirlo explícitamente con `dryRun: false`.
   */
  @Post('events/:eventId/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel an event and refund every paid order (LFPC art. 92 Bis)' })
  async cancelEvent(
    @Param('eventId') eventId: string,
    @Request() req: ScopedRequest,
    @CurrentUser() user: { email?: string; sub?: string },
    @Body()
    dto: {
      reason: string;
      attributable: boolean;
      justification?: string;
      compensationRate?: number;
      dryRun?: boolean;
    },
  ) {
    return await this.cancellations.cancelEvent({
      eventId,
      organizationId: requireScope(req) ?? undefined,
      reason: dto.reason,
      attributable: dto.attributable,
      justification: dto.justification,
      compensationRate: dto.compensationRate,
      requestedBy: user?.email || user?.sub || 'staff',
      // Se ejecuta SOLO si lo piden a propósito.
      dryRun: dto.dryRun !== false,
    });
  }

  /** Reprogramación: avisa y deja elegir al comprador, no devuelve por su cuenta. */
  @Post('events/:eventId/reschedule')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reschedule an event and notify buyers of their options' })
  async rescheduleEvent(
    @Param('eventId') eventId: string,
    @Request() req: ScopedRequest,
    @CurrentUser() user: { email?: string; sub?: string },
    @Body() dto: { newStartsAt: string; reason: string },
  ) {
    const newStartsAt = new Date(dto.newStartsAt);
    if (Number.isNaN(newStartsAt.getTime())) {
      throw new BadRequestException('newStartsAt inválido (ISO 8601)');
    }
    return await this.cancellations.rescheduleEvent({
      eventId,
      organizationId: requireScope(req) ?? undefined,
      newStartsAt,
      reason: dto.reason,
      requestedBy: user?.email || user?.sub || 'staff',
    });
  }

  @Get('config')
  @ApiOperation({ summary: 'Public payment config (Banorte direct)' })
  getConfig() {
    return this.paymentService.getBanortePublicConfig();
  }

  @Get('config/validate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validate Banorte production credentials' })
  validateConfig() {
    return this.paymentService.validateBanorteSetup();
  }

  @Post('intents')
  @ApiOperation({ summary: 'Create Banorte payment (Payworks / SPEI / OXXO)' })
  async createIntent(
    @Body()
    dto: {
      orderId: string;
      /** Ignorado: el importe sale de Order.totalAmount (F1-06). */
      amount?: number;
      /** Ignorada: la moneda sale de Order.currency. */
      currency?: string;
      buyerEmail: string;
      buyerName: string;
      paymentMethod?: string;
      publicId?: string;
    },
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // El cuerpo no decide cuánto se cobra: se descartan amount/currency.
    const { amount: _ignoredAmount, currency: _ignoredCurrency, ...safe } = dto;
    return await this.paymentService.createPaymentIntent({
      ...safe,
      idempotencyKey: idempotencyKey?.trim() || `order:${dto.orderId}`,
    });
  }

  /**
   * Confirmación manual: completa la orden sin pasar por el IPN. Es una ruta de
   * demo/soporte, así que exige sesión de administrador (F1-06) y el servicio
   * la bloquea además en producción.
   */
  @Post('confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm Banorte payment (demo only, admin)' })
  async confirmPayment(
    @Body()
    dto: {
      orderId: string;
      intentId?: string;
      externalId?: string;
    },
  ) {
    return await this.paymentService.confirmBanortePayment(dto);
  }

  @Post(':orderId/refunds')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'TAQUILLA_SUPERVISOR', 'FINANCE')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request refund via Banorte (audited)' })
  async createRefund(
    @Param('orderId') orderId: string,
    @Body() dto: { reason: string; amount?: number; notes?: string },
    @Request() req: ScopedRequest,
    @CurrentUser() user: { email?: string; sub?: string; id?: string },
  ) {
    return await this.paymentService.createRefund({
      orderId,
      ...dto,
      organizationId: requireScope(req),
      requestedBy: user?.email || user?.sub || 'staff',
    });
  }

  /**
   * Cola de reembolsos. Sin esto el admin la armaba pidiendo orden por orden.
   *
   * `OrgAccessGuard` cotejará `?organizationId=` contra el tenant del token:
   * solo SUPER_ADMIN puede pedir otra organización o atravesarlas todas.
   */
  @Get('refunds')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List refunds (support queue) with cursor pagination' })
  async listRefunds(
    @Request() req: ScopedRequest,
    @Query('status') status?: string,
    @Query('eventId') eventId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
  ) {
    return await this.paymentService.listRefunds({
      organizationId: requireScope(req),
      status: parseRefundStatus(status),
      eventId,
      cursor,
      limit: limit ? Number(limit) : undefined,
      sort: sort === 'oldest' ? 'oldest' : 'newest',
    });
  }

  /** Cuadre por periodo: esperado vs. liquidado vs. reembolsado, por moneda. */
  @Get('reconciliation')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Settlement reconciliation by period and currency' })
  // El nombre lleva prefijo para no chocar con la propiedad inyectada
  // `reconciliation` (BanorteReconciliationService); la ruta sigue siendo la misma.
  async getReconciliation(
    @Request() req: ScopedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('eventId') eventId?: string,
  ) {
    return await this.paymentService.reconciliationReport({
      organizationId: requireScope(req),
      eventId,
      from,
      to,
    });
  }

  /** Incidencias de liquidación auditadas (antes ilegibles en `AuditEvent`). */
  @Get('reconciliation/incidents')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Audited settlement incidents (mismatch / late / no inventory)' })
  async settlementIncidents(
    @Request() req: ScopedRequest,
    @Query('action') action?: string,
    @Query('entityId') entityId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return await this.paymentService.listSettlementIncidents({
      organizationId: requireScope(req),
      action,
      entityId,
      from,
      to,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('refunds/:refundId/complete')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'TAQUILLA_SUPERVISOR', 'FINANCE')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mark pending Banorte-portal refund as completed and release inventory',
  })
  async completeManualRefund(
    @Param('refundId') refundId: string,
    @Body() dto: { banorteReference?: string },
    @Request() req: ScopedRequest,
    @CurrentUser() user: { email?: string; sub?: string },
  ) {
    return await this.paymentService.completeManualRefund(
      refundId,
      user?.email || user?.sub || 'admin',
      dto.banorteReference,
      requireScope(req),
    );
  }

  @Post('webhooks/banorte')
  @ApiOperation({ summary: 'Banorte IPN / Payworks webhook' })
  async handleBanorteWebhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-banorte-signature') sig: string,
    @Headers('x-signature') sigAlt: string,
  ) {
    return await this.paymentService.handleBanorteWebhook(body, sig || sigAlt);
  }

  @Post('reconcile/spei')
  @ApiOperation({ summary: 'Reconcile pending SPEI/OXXO (requires X-Internal-Secret)' })
  async reconcileSpei(@Headers('x-internal-secret') internalSecret?: string) {
    // requireInternalApiSecret rechaza secretos ausentes, débiles o de ejemplo.
    let expected: string;
    try {
      expected = requireInternalApiSecret();
    } catch (e) {
      // Falla cerrado sin revelar al llamador cómo está configurado el servidor.
      this.logger.error(`INTERNAL_API_SECRET no utilizable: ${e instanceof Error ? e.message : e}`);
      throw new UnauthorizedException('X-Internal-Secret required for reconcile');
    }
    if (!internalSecret || !timingSafeEqualString(expected, internalSecret)) {
      throw new UnauthorizedException('X-Internal-Secret required for reconcile');
    }
    return this.reconciliation.reconcilePendingSpei();
  }

  /**
   * URL de retorno del navegador tras Payworks.
   *
   * F1-06: antes completaba la orden. Un GET disparado por el navegador del
   * comprador (o por cualquiera que adivinara el orderId) no es prueba de cobro;
   * la única fuente de verdad es el IPN firmado. Aquí solo se consulta estado.
   */
  @Get('webhooks/banorte/return')
  @ApiOperation({ summary: 'Return URL after Payworks (consulta idempotente, no muta estado)' })
  async payworksReturn(@Query('orderId') orderId: string, @Query('result') result: string) {
    const status = orderId
      ? await this.paymentService.getOrderPaymentStatus(orderId)
      : null;
    return {
      ok: result === 'ok',
      orderId,
      orderStatus: status?.status ?? null,
      paid: status?.paid ?? false,
      note: 'La confirmación del cobro llega por IPN Banorte; esta URL no cambia el estado de la orden.',
    };
  }
}
