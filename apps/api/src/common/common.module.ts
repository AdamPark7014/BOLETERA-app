import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../modules/prisma/prisma.module';
import { RedisService } from './redis.service';
import { AuditService } from './audit.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [RedisService, AuditService],
  exports: [RedisService, AuditService],
})
export class CommonModule {}
