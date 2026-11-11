import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EventPublishValidationModule } from './event-publish-validation.module';
import { EventManagementService } from './event-management.service';
import { EventManagementController } from './event-management.controller';
import { EventSeriesController } from './event-series.controller';
import { EventSeriesService } from './event-series.service';
import { SaleWindowService } from './sale-window.service';
import { SalePhaseQuotaService } from './sale-phase-quota.service';
import { ProfecoDisclosureService } from './profeco-disclosure.service';
import {
  ProfecoDisclosureAdminController,
  ProfecoDisclosurePublicController,
} from './profeco-disclosure.controller';

@Module({
  // `RedisService` llega por `CommonModule`, que es @Global.
  imports: [PrismaModule, EventPublishValidationModule],
  controllers: [
    EventManagementController,
    // Series y vista previa de recurrencia del panel (events/schedule/*).
    EventSeriesController,
    // El publico va SIN guardas: una transparencia que exige credenciales no lo es.
    ProfecoDisclosurePublicController,
    ProfecoDisclosureAdminController,
  ],
  providers: [
    EventManagementService,
    EventSeriesService,
    SaleWindowService,
    SalePhaseQuotaService,
    ProfecoDisclosureService,
  ],
  // `SaleWindowService` se exporta a propósito: inventory y orders deben
  // importar este módulo y preguntar antes de vender. El cupo de fase se aparta
  // por su `assertSaleWindowOpenAndReserve`, así que no hace falta exportar
  // `SalePhaseQuotaService` fuera del módulo.
  exports: [
    EventManagementService,
    SaleWindowService,
    ProfecoDisclosureService,
    EventPublishValidationModule,
  ],
})
export class EventManagementModule {}
