import { Controller, Post, Get, Put, Param, Body, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ChannelManagementService } from './channel-management.service';
import type { ApiPartnerDto, ChannelConfigDto, TaquillaLocationDto } from './channel.dto';
import { assertChannelConfig } from './channel-validate';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@ApiTags('Channel Management')
@Controller('channels')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ChannelManagementController {
  constructor(private channelService: ChannelManagementService) {}

  @Post(':eventId/configure')
  @Roles('PROMOTER', 'ADMIN')
  @ApiOperation({ summary: 'Configure sales channels' })
  async configureChannels(@Param('eventId') eventId: string, @Body() config: ChannelConfigDto) {
    return await this.channelService.configureChannels(eventId, assertChannelConfig(config));
  }

  @Post(':eventId/allocate-inventory')
  @Roles('PROMOTER', 'ADMIN')
  @ApiOperation({ summary: 'Allocate inventory to channels' })
  async allocateInventory(
    @Param('eventId') eventId: string,
    @Body() data: { totalTickets: number }
  ) {
    return await this.channelService.allocateInventoryToChannels(eventId, data.totalTickets);
  }

  @Get(':eventId/health')
  @Roles('PROMOTER', 'ADMIN')
  @ApiOperation({ summary: 'Get channel health status' })
  async getChannelHealth(@Param('eventId') eventId: string) {
    return await this.channelService.getChannelHealth(eventId);
  }

  @Post(':eventId/reallocate')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Dynamic channel reallocation based on demand' })
  async dynamicReallocate(@Param('eventId') eventId: string) {
    return await this.channelService.dynamicReallocate(eventId);
  }

  @Get(':eventId/analytics')
  @Roles('PROMOTER', 'ADMIN')
  @ApiOperation({ summary: 'Channel performance analytics' })
  async getAnalytics(@Param('eventId') eventId: string) {
    return await this.channelService.getChannelAnalytics(eventId);
  }

  @Post(':eventId/partners')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Add API partner' })
  async addPartner(@Param('eventId') eventId: string, @Body() partner: ApiPartnerDto) {
    return await this.channelService.addApiPartner(eventId, partner);
  }

  @Post(':eventId/taquilla-location')
  @Roles('PROMOTER', 'ADMIN')
  @ApiOperation({ summary: 'Add taquilla location' })
  async addTaquillaLocation(
    @Param('eventId') eventId: string,
    @Body() location: TaquillaLocationDto
  ) {
    return await this.channelService.addTaquillaLocation(eventId, location);
  }
}
