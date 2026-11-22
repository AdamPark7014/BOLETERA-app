import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { MetricsModule } from '../metrics/metrics.module';
import { PrismaModule } from '../prisma/prisma.module';
import {
  TrackingLinksController,
  TrackingLinksPublicController,
} from './tracking-links.controller';
import { TrackingLinksService } from './tracking-links.service';

@Module({
  imports: [PrismaModule, AuthModule, CommonModule, MetricsModule],
  controllers: [TrackingLinksController, TrackingLinksPublicController],
  providers: [TrackingLinksService],
  exports: [TrackingLinksService],
})
export class TrackingLinksModule {}
