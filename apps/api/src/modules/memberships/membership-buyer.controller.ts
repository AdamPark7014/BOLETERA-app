import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MembershipCheckoutService } from './membership-checkout.service';

type BuyerUser = { sub?: string; id?: string };

/**
 * Lado del comprador: planes públicos del sitio, compra (pagada por el camino
 * de las órdenes) y «Mi membresía». Sin roles de operación: basta la sesión.
 */
@ApiTags('Memberships')
@Controller('memberships')
export class MembershipBuyerController {
  constructor(private checkout: MembershipCheckoutService) {}

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

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mis membresías: plan, vigencia y beneficios' })
  mine(@CurrentUser() user: BuyerUser) {
    return this.checkout.mine(user?.sub || user?.id || '');
  }
}
