import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EventManagementService } from './event-management.service';
import { EventManagementController } from './event-management.controller';
import { SaleWindowService } from './sale-window.service';

@Module({
  imports: [PrismaModule],
  controllers: [EventManagementController],
  providers: [EventManagementService, SaleWindowService],
  // `SaleWindowService` se exporta a propósito: inventory y orders deben
  // importar este módulo y preguntar antes de vender.
  exports: [EventManagementService, SaleWindowService]
})
export class EventManagementModule {}
