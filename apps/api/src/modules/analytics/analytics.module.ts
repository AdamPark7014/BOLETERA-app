import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  // AuthModule aporta EventOrgAccessGuard (necesita PrismaService inyectado);
  // sin importarlo, Nest no podría resolver sus dependencias en este contexto.
  imports: [PrismaModule, AuthModule],
  // AiController: rutas /ai/* deterministas (sin modelo de lenguaje).
  controllers: [AnalyticsController, AiController],
  providers: [AnalyticsService, AiService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
