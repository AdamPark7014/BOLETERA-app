import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ClaudeClient } from './claude-client';
import { SmartSearchController } from './smart-search.controller';
import { SmartSearchService } from './smart-search.service';

@Module({
  imports: [TenantModule, PrismaModule],
  controllers: [SmartSearchController],
  providers: [SmartSearchService, ClaudeClient],
  exports: [SmartSearchService],
})
export class SmartSearchModule {}
