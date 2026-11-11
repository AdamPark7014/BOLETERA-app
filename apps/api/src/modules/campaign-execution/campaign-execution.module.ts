import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CampaignExecutionService } from './campaign-execution.service';
import { CampaignExecutionController } from './campaign-execution.controller';

@Module({
  imports: [PrismaModule],
  controllers: [CampaignExecutionController],
  providers: [CampaignExecutionService],
  exports: [CampaignExecutionService],
})
export class CampaignExecutionModule {}
