import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { TaquillaPosService } from './taquilla-pos.service';
import type {
  CashDropDto,
  CreateHoldDto,
  EndSessionDto,
  ExchangeDto,
  HandoffDto,
  InitTerminalDto,
  ManagerPinDto,
  ProcessPaymentDto,
  QuickCheckoutDto,
  ReleaseHoldsDto,
  StartSessionDto,
  SyncOfflineDto,
  VerifyPinDto,
  VoidOrderDto,
  WillcallFulfillDto,
  WillcallLookupDto,
} from './taquilla-pos.dto';

type JwtUser = { sub: string; role?: string; organizationId?: string | null };

/**
 * Organización con la que se acotan búsquedas de boletos y will-call. Sale del
 * JWT, nunca del cuerpo: antes `willcall/lookup` tomaba `organizationId` del
 * body y, si se omitía, buscaba por nombre/correo en TODAS las organizaciones.
 * SUPER_ADMIN puede pedir otra org explícita (o ninguna). Sin org → 403.
 */
export function posOrgScope(user: JwtUser | undefined, requested?: string): string | undefined {
  if (user?.role === 'SUPER_ADMIN') return requested || user.organizationId || undefined;
  if (!user?.organizationId) {
    throw new ForbiddenException('Usuario sin organización asignada');
  }
  return user.organizationId;
}

/** Roles de la puerta: el escáner solo lista funciones y escanea. */
export const GATE_ROLES = [
  'TAQUILLA',
  'TAQUILLA_SUPERVISOR',
  'VENUE_MANAGER',
  'PROMOTER',
  'ADMIN',
  'SUPER_ADMIN',
  'SCANNER',
] as const;

@ApiTags('Taquilla / POS')
@ApiBearerAuth()
@Controller('taquilla')
@UseGuards(JwtAuthGuard, RolesGuard)
// SCANNER no va en la clase: con él aquí abría turno, veía cortes y podía
// cobrar. Solo lee las funciones y escanea (métodos marcados abajo).
@Roles('TAQUILLA', 'TAQUILLA_SUPERVISOR', 'VENUE_MANAGER', 'PROMOTER', 'ADMIN', 'SUPER_ADMIN')
export class TaquillaPosController {
  constructor(private posService: TaquillaPosService) {}

  @Post('terminal/init')
  @ApiOperation({ summary: 'Initialize POS terminal' })
  async initTerminal(@Request() req: { user: JwtUser }, @Body() data: InitTerminalDto) {
    const organizationId = posOrgScope(req.user, data.organizationId);
    if (!organizationId) {
      throw new ForbiddenException('Sin organización válida');
    }
    return await this.posService.initializeTerminal({ ...data, organizationId });
  }

  @Post('session/start')
  @ApiOperation({ summary: 'Start cashier session with opening cash float' })
  async startSession(@Request() req: { user: JwtUser }, @Body() data: StartSessionDto) {
    // El turno es del cajero autenticado; el body no puede suplantar a otro.
    const cashierId =
      req.user.role === 'SUPER_ADMIN' && data.cashierId ? data.cashierId : req.user.sub;
    return await this.posService.startCashierSession(
      data.terminalId,
      cashierId,
      data.openingCash ?? 0
    );
  }

  @Post('holds')
  @ApiOperation({ summary: 'Create taquilla holds (seats or GA) with short TTL' })
  async createHold(@Request() req: { user: JwtUser }, @Body() data: CreateHoldDto) {
    return await this.posService.createPosHold({
      ...data,
      organizationId: posOrgScope(req.user),
    });
  }

  @Post('holds/release')
  @ApiOperation({ summary: 'Release active holds' })
  async releaseHolds(@Body() data: ReleaseHoldsDto) {
    return await this.posService.releaseHolds(data.holdIds);
  }

  @Get('events')
  @Roles(...GATE_ROLES)
  @ApiOperation({ summary: 'Events on sale at this box office (JWT organization)' })
  async events(@Request() req: { user: JwtUser }) {
    return await this.posService.listPosEvents(posOrgScope(req.user));
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Checkout at box office (GA or reserved seats)' })
  async quickCheckout(@Request() req: { user: JwtUser }, @Body() data: QuickCheckoutDto) {
    return await this.posService.quickCheckout(
      data.terminalId,
      data.sessionId,
      data.checkoutData,
      posOrgScope(req.user)
    );
  }

  @Post('terminal/init-org')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('TAQUILLA', 'TAQUILLA_SUPERVISOR', 'PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Initialize POS terminal for organization' })
  async initTerminalOrg(
    @Body()
    data: {
      organizationId: string;
      locationName: string;
      terminalName: string;
      hardwareConfig?: Record<string, string>;
    }
  ) {
    return await this.posService.initializeTerminal(data);
  }

  @Post('payment')
  @ApiOperation({ summary: 'Legacy payment stub — prefer checkout', deprecated: true })
  async processPayment(@Body() data: ProcessPaymentDto) {
    return await this.posService.processPayment(data.orderId, data.paymentData);
  }

  @Get('receipt/:orderId')
  @ApiOperation({ summary: 'Generate receipt' })
  async generateReceipt(
    @Request() req: { user: JwtUser },
    @Param('orderId') orderId: string,
    @Query('terminalId') terminalId: string
  ) {
    return await this.posService.generateReceipt(
      orderId,
      terminalId ?? 'terminal',
      posOrgScope(req.user)
    );
  }

  @Post('scan')
  @Roles(...GATE_ROLES)
  @ApiOperation({ summary: 'Scan ticket barcode or order publicId' })
  async scanBarcode(
    @Request() req: { user: JwtUser },
    @Body() data: { terminalId: string; barcode: string }
  ) {
    return await this.posService.scanBarcode(data.terminalId, data.barcode, posOrgScope(req.user));
  }

  @Post('void')
  @Roles(
    'TAQUILLA',
    'TAQUILLA_SUPERVISOR',
    'TAQUILLA_ADMIN',
    'VENUE_MANAGER',
    'ADMIN',
    'SUPER_ADMIN'
  )
  @ApiOperation({ summary: 'Void a taquilla sale (requires manager PIN)' })
  async voidOrder(@Body() data: VoidOrderDto) {
    return await this.posService.voidOrder(data);
  }

  @Post('willcall/lookup')
  @ApiOperation({ summary: 'Lookup orders for will-call pickup' })
  async willcallLookup(@Request() req: { user: JwtUser }, @Body() data: WillcallLookupDto) {
    return await this.posService.willcallLookup(data.q, posOrgScope(req.user, data.organizationId));
  }

  @Post('willcall/fulfill')
  @ApiOperation({ summary: 'Mark will-call order as picked up' })
  async willcallFulfill(@Request() req: { user: JwtUser }, @Body() data: WillcallFulfillDto) {
    return await this.posService.willcallFulfill(
      data.orderId,
      data.cashierId,
      data.terminalId,
      posOrgScope(req.user)
    );
  }

  @Post('exchange')
  @ApiOperation({ summary: 'Exchange / upgrade seats (void + new sale)' })
  async exchange(@Body() data: ExchangeDto) {
    return await this.posService.exchange(data);
  }

  @Post('session/cash-drop')
  @ApiOperation({ summary: 'Record mid-shift cash drawer drop' })
  async cashDrop(@Body() data: CashDropDto) {
    return await this.posService.addCashDrop(
      data.sessionId,
      data.amount,
      data.cashierId,
      data.note,
      data.managerPin
    );
  }

  @Post('session/handoff')
  @ApiOperation({ summary: 'Close current shift and open for another cashier' })
  async handoff(@Body() data: HandoffDto) {
    return await this.posService.handoff(data);
  }

  @Post('manager-pin')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER', 'PROMOTER')
  @ApiOperation({ summary: 'Set organization manager PIN' })
  async setManagerPin(@Body() data: ManagerPinDto) {
    return await this.posService.setManagerPin(data.organizationId, data.pin, data.currentPin);
  }

  @Post('manager-pin/verify')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify manager PIN' })
  async verifyPin(@Request() req: { user: JwtUser }, @Body() data: VerifyPinDto) {
    const organizationId = posOrgScope(req.user, data.organizationId);
    if (!organizationId) {
      throw new ForbiddenException('Sin organización válida');
    }
    return await this.posService.verifyManagerPin(organizationId, data.pin);
  }

  @Get('z-reports')
  @ApiOperation({ summary: 'List archived Z-reports for organization' })
  async zReports(
    @Request() req: { user: JwtUser },
    @Query('organizationId') organizationId?: string
  ) {
    const orgId = posOrgScope(req.user, organizationId);
    if (!orgId) {
      throw new ForbiddenException('Sin organización válida');
    }
    return await this.posService.listZReports(orgId);
  }

  @Post('sync-inventory')
  @ApiOperation({ summary: 'Sync inventory with terminal' })
  async syncInventory(@Body() data: { terminalId: string; eventId: string }) {
    return await this.posService.syncInventory(data.terminalId, data.eventId);
  }

  @Post('offline/enable/:terminalId')
  @ApiOperation({ summary: 'Enable offline mode' })
  async enableOffline(@Param('terminalId') terminalId: string) {
    return await this.posService.enableOfflineMode(terminalId);
  }

  @Post('offline/sync/:terminalId')
  @ApiOperation({ summary: 'Sync offline transactions' })
  async syncOffline(
    @Request() req: { user: JwtUser },
    @Param('terminalId') terminalId: string,
    @Body() data: SyncOfflineDto
  ) {
    return await this.posService.syncOfflineTransactions(
      terminalId,
      data.transactions,
      posOrgScope(req.user)
    );
  }

  @Post('session/end')
  @ApiOperation({ summary: 'End cashier session with cash count (Z-report)' })
  async endSession(@Request() req: { user: JwtUser }, @Body() data: EndSessionDto) {
    const cashierId =
      req.user.role === 'SUPER_ADMIN' && data.cashierId ? data.cashierId : req.user.sub;
    return await this.posService.endCashierSession(
      data.sessionId,
      cashierId,
      data.closingCashCounted,
      data.managerPin
    );
  }

  @Get('session/summary')
  @ApiOperation({ summary: 'Live shift summary for open session' })
  async sessionSummary(
    @Request() req: { user: JwtUser },
    @Query('sessionId') sessionId: string
  ) {
    return await this.posService.getSessionSummary(sessionId, posOrgScope(req.user));
  }

  @Get('settings')
  @ApiOperation({ summary: 'POS settings for the cashier organization' })
  async getPosSettings(@Request() req: { user: JwtUser }) {
    const organizationId = posOrgScope(req.user);
    if (!organizationId) {
      throw new ForbiddenException('Sin organización válida');
    }
    return await this.posService.getPosSettings(organizationId);
  }

  @Post('settings')
  @Roles('TAQUILLA_SUPERVISOR', 'VENUE_MANAGER', 'PROMOTER', 'ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Update POS settings (manager)' })
  async updatePosSettings(
    @Request() req: { user: JwtUser },
    @Body()
    data: {
      posCashVariancePinThreshold?: number;
      posEventsLookbackHours?: number;
    }
  ) {
    const organizationId = posOrgScope(req.user);
    if (!organizationId) {
      throw new ForbiddenException('Sin organización válida');
    }
    return await this.posService.updatePosSettings(organizationId, data);
  }

  @Get('analytics/:terminalId/:period')
  @ApiOperation({ summary: 'Terminal analytics' })
  async getAnalytics(
    @Param('terminalId') terminalId: string,
    @Param('period') period: 'TODAY' | 'WEEK' | 'MONTH'
  ) {
    return await this.posService.getTerminalAnalytics(terminalId, period);
  }
}
