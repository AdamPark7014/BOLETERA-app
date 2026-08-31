import { Controller, Post, Get, Param, Body, Query, UseGuards } from '@nestjs/common';
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

@ApiTags('Taquilla / POS')
@ApiBearerAuth()
@Controller('taquilla')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TAQUILLA', 'TAQUILLA_SUPERVISOR', 'VENUE_MANAGER', 'PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'SCANNER')
export class TaquillaPosController {
  constructor(private posService: TaquillaPosService) {}

  @Post('terminal/init')
  @ApiOperation({ summary: 'Initialize POS terminal' })
  async initTerminal(@Body() data: InitTerminalDto) {
    return await this.posService.initializeTerminal(data);
  }

  @Post('session/start')
  @ApiOperation({ summary: 'Start cashier session with opening cash float' })
  async startSession(@Body() data: StartSessionDto) {
    return await this.posService.startCashierSession(
      data.terminalId,
      data.cashierId,
      data.openingCash ?? 0,
    );
  }

  @Post('holds')
  @ApiOperation({ summary: 'Create taquilla holds (seats or GA) with short TTL' })
  async createHold(@Body() data: CreateHoldDto) {
    return await this.posService.createPosHold(data);
  }

  @Post('holds/release')
  @ApiOperation({ summary: 'Release active holds' })
  async releaseHolds(@Body() data: ReleaseHoldsDto) {
    return await this.posService.releaseHolds(data.holdIds);
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Checkout at box office (GA or reserved seats)' })
  async quickCheckout(@Body() data: QuickCheckoutDto) {
    return await this.posService.quickCheckout(data.terminalId, data.sessionId, data.checkoutData);
  }

  @Post('terminal/init-org')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('TAQUILLA', 'PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Initialize POS terminal for organization' })
  async initTerminalOrg(
    @Body()
    data: {
      organizationId: string;
      locationName: string;
      terminalName: string;
      hardwareConfig?: Record<string, string>;
    },
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
    @Param('orderId') orderId: string,
    @Query('terminalId') terminalId: string,
  ) {
    return await this.posService.generateReceipt(orderId, terminalId ?? 'terminal');
  }

  @Post('scan')
  @ApiOperation({ summary: 'Scan ticket barcode or order publicId' })
  async scanBarcode(@Body() data: { terminalId: string; barcode: string }) {
    return await this.posService.scanBarcode(data.terminalId, data.barcode);
  }

  @Post('void')
  @Roles('TAQUILLA', 'TAQUILLA_SUPERVISOR', 'TAQUILLA_ADMIN', 'VENUE_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Void a taquilla sale (requires manager PIN)' })
  async voidOrder(@Body() data: VoidOrderDto) {
    return await this.posService.voidOrder(data);
  }

  @Post('willcall/lookup')
  @ApiOperation({ summary: 'Lookup orders for will-call pickup' })
  async willcallLookup(@Body() data: WillcallLookupDto) {
    return await this.posService.willcallLookup(data.q, data.organizationId);
  }

  @Post('willcall/fulfill')
  @ApiOperation({ summary: 'Mark will-call order as picked up' })
  async willcallFulfill(@Body() data: WillcallFulfillDto) {
    return await this.posService.willcallFulfill(data.orderId, data.cashierId, data.terminalId);
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
      data.managerPin,
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
  async verifyPin(@Body() data: VerifyPinDto) {
    return await this.posService.verifyManagerPin(data.organizationId, data.pin);
  }

  @Get('z-reports')
  @ApiOperation({ summary: 'List archived Z-reports for organization' })
  async zReports(@Query('organizationId') organizationId: string) {
    return await this.posService.listZReports(organizationId);
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
    @Param('terminalId') terminalId: string,
    @Body() data: SyncOfflineDto,
  ) {
    return await this.posService.syncOfflineTransactions(terminalId, data.transactions);
  }

  @Post('session/end')
  @ApiOperation({ summary: 'End cashier session with cash count (Z-report)' })
  async endSession(@Body() data: EndSessionDto) {
    return await this.posService.endCashierSession(
      data.sessionId,
      data.cashierId,
      data.closingCashCounted,
      data.managerPin,
    );
  }

  @Get('session/summary')
  @ApiOperation({ summary: 'Live shift summary for open session' })
  async sessionSummary(@Query('sessionId') sessionId: string) {
    return await this.posService.getSessionSummary(sessionId);
  }

  @Get('analytics/:terminalId/:period')
  @ApiOperation({ summary: 'Terminal analytics' })
  async getAnalytics(
    @Param('terminalId') terminalId: string,
    @Param('period') period: 'TODAY' | 'WEEK' | 'MONTH',
  ) {
    return await this.posService.getTerminalAnalytics(terminalId, period);
  }
}
