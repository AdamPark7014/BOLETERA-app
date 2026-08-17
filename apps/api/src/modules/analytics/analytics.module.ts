import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  // AuthModule aporta EventOrgAccessGuard (necesita PrismaService inyectado);
  // sin importarlo, Nest no podría resolver sus dependencias en este contexto.
  imports: [PrismaModule, AuthModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
