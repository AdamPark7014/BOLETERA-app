import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionKey } from '@boletera/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { AdminService } from './admin.service';

@ApiTags('Admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(
    private admin: AdminService,
    private reconciliation: ReconciliationService,
  ) {}

  @Get('dashboard')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  dashboard(@Request() req: { user: { organizationId?: string } }) {
    return this.admin.dashboard(req.user.organizationId!);
  }

  @Get('platform/overview')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  platformOverview(@Request() req: { user: { organizationId?: string } }) {
    return this.admin.platformOverview(req.user.organizationId!);
  }

  @Get('orders')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  orders(@Request() req: { user: { organizationId?: string } }) {
    return this.admin.listOrders(req.user.organizationId!);
  }

  @Get('orders/:id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  orderDetail(
    @Request() req: { user: { organizationId?: string } },
    @Param('id') id: string,
  ) {
    return this.admin.getOrder(req.user.organizationId!, id);
  }

  @Post('orders/:id/refund')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'TAQUILLA_SUPERVISOR', 'FINANCE')
  @RequirePermissions(PermissionKey.ORDERS_REFUND)
  refundOrder(
    @Request() req: { user: { organizationId?: string; email?: string; sub?: string } },
    @Param('id') id: string,
    @Body() body: { reason?: string; amount?: number; notes?: string },
  ) {
    return this.admin.requestRefund(req.user.organizationId!, id, {
      ...body,
      requestedBy: req.user.email || req.user.sub || 'staff',
    });
  }

  @Post('orders/:id/resend-email')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  resendEmail(
    @Request() req: { user: { organizationId?: string } },
    @Param('id') id: string,
  ) {
    return this.admin.resendOrderEmail(req.user.organizationId!, id);
  }

  @Post('orders/:id/cancel')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'TAQUILLA_SUPERVISOR')
  cancelOrder(
    @Request() req: { user: { organizationId?: string } },
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.admin.cancelOrderForOrg(req.user.organizationId!, id, body.reason || 'Admin cancel');
  }

  @Get('payouts')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  payouts(@Request() req: { user: { organizationId?: string } }) {
    return this.admin.listPayouts(req.user.organizationId!);
  }

  @Post('payouts/:payoutId/process')
  @Roles('ADMIN', 'SUPER_ADMIN')
  processPayout(
    @Request() req: { user: { organizationId?: string } },
    @Param('payoutId') payoutId: string,
    @Body() body: { referenceId?: string },
  ) {
    return this.admin.markPayoutProcessing(req.user.organizationId!, payoutId, body.referenceId);
  }

  @Post('payouts/:payoutId/complete')
  @Roles('ADMIN', 'SUPER_ADMIN')
  completePayout(
    @Request() req: { user: { organizationId?: string } },
    @Param('payoutId') payoutId: string,
    @Body() body: { referenceId: string },
  ) {
    return this.admin.markPayoutCompleted(req.user.organizationId!, payoutId, body.referenceId);
  }

  @Get('events')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  events(@Request() req: { user: { organizationId?: string } }) {
    return this.admin.listEvents(req.user.organizationId!);
  }

  @Get('venues')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  venues(@Request() req: { user: { organizationId?: string } }) {
    return this.admin.listVenues(req.user.organizationId!);
  }

  @Get('branding')
  @Roles('ADMIN', 'SUPER_ADMIN')
  getBranding(@Request() req: { user: { organizationId?: string } }) {
    return this.admin.getTheme(req.user.organizationId!);
  }

  @Post('branding')
  @Roles('ADMIN', 'SUPER_ADMIN')
  branding(
    @Request() req: { user: { organizationId?: string } },
    @Body() body: { primaryColor?: string; logoUrl?: string; subdomain?: string },
  ) {
    return this.admin.updateTheme(req.user.organizationId!, body);
  }

  @Get('site-content')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  getSiteContent(@Request() req: { user: { organizationId?: string } }) {
    return this.admin.getSiteContent(req.user.organizationId!);
  }

  @Post('site-content')
  @Roles('ADMIN', 'SUPER_ADMIN')
  updateSiteContent(
    @Request() req: { user: { organizationId?: string } },
    @Body() body: { siteContent: unknown },
  ) {
    return this.admin.updateSiteContent(req.user.organizationId!, body.siteContent);
  }

  @Get('reports/sales')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  sales(
    @Request() req: { user: { organizationId?: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.admin.salesReport(req.user.organizationId!, from, to);
  }

  @Post('venues/suggest-layout')
  @Roles('ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
  suggestLayout(@Body() body: { venueId: string; planDescription: string }) {
    return this.admin.suggestLayoutFromPlan(body.venueId, body.planDescription);
  }

  @Get('reconciliation')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Operational health checks scoped to organization' })
  reconciliationHealth(@Request() req: { user: { organizationId?: string } }) {
    return this.reconciliation.runHealthChecks({
      organizationId: req.user.organizationId,
    });
  }
}
