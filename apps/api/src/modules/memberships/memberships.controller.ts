import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgAccessGuard, type OrgScopedRequest } from '../auth/org-access.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  MembershipsService,
  type CreatePlanInput,
  type MembershipActor,
} from './memberships.service';

type ScopedRequest = OrgScopedRequest & { user?: { role?: string; sub?: string; id?: string } };

const READ_ROLES = ['PROMOTER', 'VENUE_MANAGER', 'ADMIN', 'SUPER_ADMIN'] as const;
const WRITE_ROLES = ['PROMOTER', 'ADMIN', 'SUPER_ADMIN'] as const;

function actorOf(req: ScopedRequest): MembershipActor {
  return {
    userId: req.user?.sub || req.user?.id,
    role: req.user?.role,
    scopedOrganizationId: req.scopedOrganizationId ?? null,
  };
}

/**
 * Membresías por organización. El tenant viaja en `:orgId` y lo coteja
 * OrgAccessGuard; la renovación resuelve la organización desde la membresía.
 */
@ApiTags('Memberships')
@ApiBearerAuth()
@Controller('memberships')
@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
export class MembershipsController {
  constructor(private memberships: MembershipsService) {}

  @Get('organization/:orgId/plans')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Planes con miembros vigentes, beneficios y renovación' })
  plans(@Param('orgId') orgId: string) {
    return this.memberships.listPlans(orgId);
  }

  @Post('organization/:orgId/plans')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Crear plan de membresía' })
  createPlan(
    @Param('orgId') orgId: string,
    @Body() body: CreatePlanInput,
    @Request() req: ScopedRequest
  ) {
    return this.memberships.createPlan(orgId, body, actorOf(req));
  }

  @Get('organization/:orgId/metrics')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Miembros vigentes, canjes, renovación, retención e ingreso' })
  metrics(@Param('orgId') orgId: string) {
    return this.memberships.metrics(orgId);
  }

  @Get('organization/:orgId/benefits')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Beneficios con canjes usados' })
  benefits(@Param('orgId') orgId: string) {
    return this.memberships.benefits(orgId);
  }

  @Get('organization/:orgId/benefits/usage')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Canjes por beneficio' })
  benefitUsage(@Param('orgId') orgId: string) {
    return this.memberships.benefitUsage(orgId);
  }

  @Get('organization/:orgId/renewals')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Membresías en ventana de renovación' })
  renewals(@Param('orgId') orgId: string) {
    return this.memberships.renewals(orgId);
  }

  @Get('organization/:orgId/retention')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Serie mensual de retención' })
  retention(@Param('orgId') orgId: string) {
    return this.memberships.retention(orgId);
  }

  @Get('organization/:orgId/activity')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Bitácora de membresías' })
  activity(@Param('orgId') orgId: string) {
    return this.memberships.activity(orgId);
  }

  @Post('organization/:orgId/members')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Dar de alta una cuenta en un plan (cobro registrado fuera)' })
  enroll(
    @Param('orgId') orgId: string,
    @Body() body: { planId?: string; userEmail?: string },
    @Request() req: ScopedRequest
  ) {
    return this.memberships.enroll(orgId, body, actorOf(req));
  }

  @Post('organization/:orgId/plans/:planId/benefits')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Agregar beneficio a un plan' })
  createBenefit(
    @Param('orgId') orgId: string,
    @Param('planId') planId: string,
    @Body() body: { name?: string; type?: string; description?: string; redemptionLimit?: number },
    @Request() req: ScopedRequest
  ) {
    return this.memberships.createBenefit(orgId, planId, body, actorOf(req));
  }

  @Post('organization/:orgId/benefits/:benefitId/redeem')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Registrar el canje de un beneficio' })
  redeem(
    @Param('orgId') orgId: string,
    @Param('benefitId') benefitId: string,
    @Body() body: { membershipId?: string; note?: string },
    @Request() req: ScopedRequest
  ) {
    return this.memberships.redeem(orgId, benefitId, body, actorOf(req));
  }

  @Post(':membershipId/renew')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Registrar la renovación de una membresía' })
  renew(@Param('membershipId') membershipId: string, @Request() req: ScopedRequest) {
    return this.memberships.renew(membershipId, actorOf(req));
  }
}
