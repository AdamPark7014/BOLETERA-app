import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { PaymentService } from '../payment/payment.service';
import { MembershipCheckoutService } from './membership-checkout.service';

type BuyerUser = { sub?: string; id?: string };

/**
 * Lado del comprador: planes públicos del sitio, compra (pagada por el camino
 * de las órdenes) y «Mi membresía». Sin roles de operación: basta la sesión.
 */
@ApiTags('Memberships')
@Controller('memberships')
export class MembershipBuyerController {
  constructor(
    private checkout: MembershipCheckoutService,
    private payments: PaymentService
  ) {}

  @Get('public/:orgSlug/plans')
  @ApiOperation({ summary: 'Planes activos de la organización del sitio (sin sesión)' })
  publicPlans(@Param('orgSlug') orgSlug: string) {
    return this.checkout.publicPlans(orgSlug);
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Iniciar la compra de un plan (cobro Banorte de las órdenes)' })
  start(@Body() body: { planId?: string; paymentMethod?: string }, @CurrentUser() user: BuyerUser) {
    return this.checkout.start(user?.sub || user?.id, body ?? {});
  }

  @Get('checkout/:publicId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Estado de una compra de membresía propia' })
  status(@Param('publicId') publicId: string, @CurrentUser() user: BuyerUser) {
    return this.checkout.status(user?.sub || user?.id || '', publicId);
  }

  /**
   * Solo demo: el comprador confirma el pago de SU membresía. Fuera de demo o en
   * producción la ruta no existe (404); sin sesión, 401; ajena, 404 (como el
   * estado). Guard opcional para que el 404 de «no demo» vaya antes que el 401.
   */
  @Post('checkout/:publicId/demo-confirm')
  @HttpCode(200)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Demo: confirmar el pago de una compra de membresía propia' })
  async demoConfirm(@Param('publicId') publicId: string, @CurrentUser() user?: BuyerUser) {
    if (!this.payments.isBuyerDemoConfirmAvailable()) throw new NotFoundException();
    const userId = user?.sub || user?.id;
    if (!userId) throw new UnauthorizedException('Inicia sesión para confirmar el pago.');
    const own = await this.checkout.status(userId, publicId);
    return this.payments.confirmBuyerDemoPurchase(own.id, own.publicId);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mis membresías: plan, vigencia y beneficios' })
  mine(@CurrentUser() user: BuyerUser) {
    return this.checkout.mine(user?.sub || user?.id || '');
  }
}
