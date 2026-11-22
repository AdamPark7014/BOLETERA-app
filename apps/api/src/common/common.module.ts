import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../modules/prisma/prisma.module';
import { RedisService } from './redis.service';
import { ReadCacheService } from './read-cache.service';
import { AuditService } from './audit.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [RedisService, ReadCacheService, AuditService],
  exports: [RedisService, ReadCacheService, AuditService],
})
export class CommonModule {}
