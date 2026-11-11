import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { PartnersService } from './partners.service';

@ApiTags('Partners / API Keys')
@ApiBearerAuth()
@Controller('partners')
@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
export class PartnersController {
  constructor(private partners: PartnersService) {}

  @Get(':orgId/keys')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  list(@Param('orgId') orgId: string) {
    return this.partners.listApiKeys(orgId);
  }

  @Post(':orgId/keys')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  create(
    @Param('orgId') orgId: string,
    @Body()
    body: { name: string; scopes?: string[]; rateLimit?: number; expiresInDays?: number }
  ) {
    return this.partners.createApiKey(orgId, body);
  }

  @Patch(':orgId/keys/:keyId/revoke')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  revoke(@Param('orgId') orgId: string, @Param('keyId') keyId: string) {
    return this.partners.revokeApiKey(orgId, keyId);
  }
}
