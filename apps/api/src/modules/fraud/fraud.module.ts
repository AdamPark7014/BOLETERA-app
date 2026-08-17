import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { FraudService } from './fraud.service';
import { FraudController } from './fraud.controller';

@Module({
  // AuthModule aporta Org/EventOrgAccessGuard (necesitan PrismaService inyectado).
  imports: [PrismaModule, AuthModule],
  controllers: [FraudController],
  providers: [FraudService],
  exports: [FraudService],
})
export class FraudModule {}

