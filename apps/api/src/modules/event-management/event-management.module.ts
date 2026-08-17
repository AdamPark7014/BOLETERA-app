import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EventManagementService } from './event-management.service';
import { EventManagementController } from './event-management.controller';
import { SaleWindowService } from './sale-window.service';
import { SalePhaseQuotaService } from './sale-phase-quota.service';

@Module({
  // `RedisService` llega por `CommonModule`, que es @Global.
  imports: [PrismaModule],
  controllers: [EventManagementController],
  providers: [EventManagementService, SaleWindowService, SalePhaseQuotaService],
  // `SaleWindowService` se exporta a propósito: inventory y orders deben
  // importar este módulo y preguntar antes de vender. El cupo de fase se aparta
  // por su `assertSaleWindowOpenAndReserve`, así que no hace falta exportar
  // `SalePhaseQuotaService` fuera del módulo.
  exports: [EventManagementService, SaleWindowService]
})
export class EventManagementModule {}
