import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChannelManagementService } from './channel-management.service';
import { ChannelManagementController } from './channel-management.controller';
import { ChannelQuotaService } from './channel-quota.service';

@Module({
  imports: [PrismaModule],
  controllers: [ChannelManagementController],
  providers: [ChannelManagementService, ChannelQuotaService],
  exports: [ChannelManagementService, ChannelQuotaService],
})
export class ChannelManagementModule {}
