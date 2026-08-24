import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { PlatformSuperController } from './platform-super.controller';
import { PlatformSuperService } from './platform-super.service';

@Module({
  imports: [AuthModule, PrismaModule, ReconciliationModule],
  controllers: [PlatformSuperController],
  providers: [PlatformSuperService],
})
export class PlatformSuperModule {}
