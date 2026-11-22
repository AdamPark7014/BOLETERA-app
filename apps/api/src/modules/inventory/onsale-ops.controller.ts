import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgAccessGuard, type OrgScopedRequest } from '../auth/org-access.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { OnsaleOpsService } from './onsale-ops.service';

type ScopedRequest = OrgScopedRequest & {
  user?: { role?: string; organizationId?: string | null };
};

@ApiTags('Onsale Ops')
@ApiBearerAuth()
@Controller('admin/events/:eventId/onsale-ops')
@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
@Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
export class OnsaleOpsController {
  constructor(
    private readonly ops: OnsaleOpsService,
    private readonly prisma: PrismaService
  ) {}

  private async assertEventOrg(eventId: string, req: ScopedRequest) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { organizationId: true },
    });
    if (!event) throw new BadRequestException('Evento no encontrado');
    const orgId = req.scopedOrganizationId || req.user?.organizationId;
    if (orgId && event.organizationId !== orgId) {
      throw new BadRequestException('Evento fuera de tu organización');
    }
  }

  @Get()
  @ApiOperation({ summary: 'Tablero de operación en vivo del evento' })
  async snapshot(@Param('eventId') eventId: string, @Request() req: ScopedRequest) {
    await this.assertEventOrg(eventId, req);
    return this.ops.snapshot(eventId);
  }

  @Patch()
  @ApiOperation({ summary: 'Pausar fila, ritmo de admisión o cerrar venta' })
  async patch(
    @Param('eventId') eventId: string,
    @Request() req: ScopedRequest,
    @Body()
    body: {
      pauseAdmission?: boolean;
      batchSize?: number;
      batchIntervalSeconds?: number;
      closeSale?: boolean;
    }
  ) {
    await this.assertEventOrg(eventId, req);
    return this.ops.patchControls(eventId, body);
  }
}
