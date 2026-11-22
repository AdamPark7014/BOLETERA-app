import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EventAnalyticsService } from './event-analytics.service';
import { MetricsController, MetricsPublicController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  imports: [PrismaModule, AuthModule, CommonModule],
  controllers: [MetricsController, MetricsPublicController],
  providers: [MetricsService, EventAnalyticsService],
  exports: [MetricsService, EventAnalyticsService],
})
export class MetricsModule {}
