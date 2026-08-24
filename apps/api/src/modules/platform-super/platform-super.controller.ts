import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PermissionKey } from '@boletera/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { PlatformSuperService } from './platform-super.service';

@ApiTags('Platform Super')
@Controller('platform/super')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@ApiBearerAuth()
export class PlatformSuperController {
  constructor(
    private platformSuper: PlatformSuperService,
    private reconciliation: ReconciliationService,
  ) {}

  @Get('overview')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(PermissionKey.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Global platform overview (superuser only)' })
  overview() {
    return this.platformSuper.overview();
  }

  @Get('health-checks')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Cross-tenant operational health checks (read-only)' })
  healthChecks(@Query('organizationId') organizationId?: string) {
    return this.reconciliation.runHealthChecks(
      organizationId ? { organizationId } : {},
    );
  }

  @Get('search')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Cross-tenant global search (superuser only)',
    description:
      'Unified search across users, customers, events, orders, tickets, venues, organizations and promoters.',
  })
  @ApiQuery({ name: 'q', required: true, description: 'Search query (min 2 characters)' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Max results per entity type (default 5, max 20)',
  })
  search(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.platformSuper.search(q, limit ? Number(limit) : undefined);
  }
}
