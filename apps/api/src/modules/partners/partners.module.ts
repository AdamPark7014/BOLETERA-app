import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiKeyGuard } from './api-key.guard';
import { PartnerApiController } from './partner-api.controller';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';

@Module({
  imports: [PrismaModule],
  controllers: [PartnersController, PartnerApiController],
  providers: [PartnersService, ApiKeyGuard],
  exports: [PartnersService, ApiKeyGuard],
})
export class PartnersModule {}
