import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { OrganizationService } from './organization.service';

@ApiTags('Organization')
@ApiBearerAuth()
@Controller('organization')
@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
export class OrganizationController {
  constructor(private orgService: OrganizationService) {}

  @Get('capabilities')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  capabilities(@Query('organizationId') orgId: string) {
    return this.orgService.getSaasCapabilities(orgId);
  }

  @Get(':orgId')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  get(@Param('orgId') orgId: string) {
    return this.orgService.getOrganization(orgId);
  }

  @Patch(':orgId')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  update(
    @Param('orgId') orgId: string,
    @Body()
    body: Partial<{
      name: string;
      description: string;
      website: string;
      email: string;
      phone: string;
      commissionRate: number;
      allowResale: boolean;
      resaleCommission: number;
    }>,
  ) {
    return this.orgService.updateOrganization(orgId, body);
  }

  @Get(':orgId/team')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  team(@Param('orgId') orgId: string) {
    return this.orgService.listTeam(orgId);
  }

  @Post(':orgId/team')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  invite(
    @Param('orgId') orgId: string,
    @Body()
    body: {
      email: string;
      firstName: string;
      lastName: string;
      role: UserRole;
      password: string;
    },
  ) {
    return this.orgService.inviteTeamMember(orgId, body);
  }

  @Patch(':orgId/team/:userId')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  updateMember(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: { role?: UserRole; active?: boolean },
  ) {
    return this.orgService.updateTeamMember(orgId, userId, body);
  }

  @Get(':orgId/audit')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  audit(@Param('orgId') orgId: string, @Query('limit') limit?: string) {
    return this.orgService.getAuditLog(orgId, limit ? parseInt(limit, 10) : 50);
  }
}


