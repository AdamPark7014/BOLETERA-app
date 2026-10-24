import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrgAccessGuard, type OrgScopedRequest } from '../auth/org-access.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TicketTransferService } from './ticket-transfer.service';

type ScopedRequest = OrgScopedRequest & { user?: { role?: string } };

@ApiTags('Ticket Transfer')
@Controller('tickets/transfer')
export class TicketTransferController {
  constructor(private transferService: TicketTransferService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  initiate(
    @CurrentUser() user: { sub: string },
    @Body() body: { ticketId: string; toEmail: string; message?: string },
  ) {
    return this.transferService.initiate({
      ticketId: body.ticketId,
      fromUserId: user.sub,
      toEmail: body.toEmail,
      message: body.message,
    });
  }

  @Post('accept')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  accept(@CurrentUser() user: { sub: string }, @Body() body: { transferCode: string }) {
    return this.transferService.accept(body.transferCode, user.sub);
  }

  @Get('queue')
  @UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiBearerAuth()
  queue(@Request() req: ScopedRequest) {
    const orgId = req.scopedOrganizationId ?? null;
    if (!orgId && req.user?.role !== 'SUPER_ADMIN') {
      throw new BadRequestException('organizationId requerido');
    }
    return this.transferService.listForOrganization(orgId);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  mine(@CurrentUser() user: { sub: string }) {
    return this.transferService.listByUser(user.sub);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  cancel(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.transferService.cancel(id, user.sub);
  }
}


