import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { BillingService } from './billing.service';

@ApiTags('Billing / CFDI')
@ApiBearerAuth()
@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
@Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN')
export class BillingController {
  constructor(private billing: BillingService) {}

  @Get(':orgId/fiscal-profile')
  @ApiOperation({ summary: 'Get organization fiscal profile (CFDI)' })
  getProfile(@Param('orgId') orgId: string) {
    return this.billing.getFiscalProfile(orgId);
  }

  @Post(':orgId/fiscal-profile')
  @ApiOperation({ summary: 'Upsert fiscal profile for CFDI stamping' })
  upsertProfile(
    @Param('orgId') orgId: string,
    @Body()
    body: {
      rfc: string;
      legalName: string;
      regimenFiscal?: string;
      codigoPostal: string;
      serie?: string;
      pacMode?: string;
      pacProvider?: string;
      pacApiKey?: string;
    }
  ) {
    return this.billing.upsertFiscalProfile(orgId, body);
  }

  @Post(':orgId/cfdi/stamp')
  @ApiOperation({ summary: 'Stamp CFDI 4.0 for a completed order (sandbox by default)' })
  stamp(
    @Param('orgId') orgId: string,
    @Body()
    body: {
      orderId: string;
      receptorRfc: string;
      receptorNombre: string;
      receptorUsoCfdi?: string;
    }
  ) {
    return this.billing.stampOrderInvoice(orgId, body);
  }

  @Get(':orgId/cfdi')
  @ApiOperation({ summary: 'List CFDI invoices for organization' })
  list(@Param('orgId') orgId: string) {
    return this.billing.listInvoices(orgId);
  }
}
