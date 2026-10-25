import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CampaignExecutionModule } from '../campaign-execution/campaign-execution.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PricingService } from './pricing.service';
import { PricingController } from './pricing.controller';

@Module({
  imports: [PrismaModule, AuthModule, CampaignExecutionModule],
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}

