import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CampaignExecutionModule } from '../campaign-execution/campaign-execution.module';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BanorteReconciliationService } from './banorte-reconciliation.service';
import { EventCancellationService } from './event-cancellation.service';
import { PaymentIdempotencyWiring } from './payment-idempotency.wiring';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';

@Module({
  imports: [ConfigModule, PrismaModule, NotificationModule, CampaignExecutionModule],
  controllers: [PaymentController],
  providers: [
    PaymentIdempotencyWiring,
    EventCancellationService,
    PaymentService,
    BanorteReconciliationService,
  ],
  exports: [EventCancellationService, PaymentService, BanorteReconciliationService],
})
export class PaymentModule {}


