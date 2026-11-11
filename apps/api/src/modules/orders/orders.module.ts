import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { CampaignExecutionModule } from '../campaign-execution/campaign-execution.module';
import { ChannelManagementModule } from '../channel-management/channel-management.module';
import { FraudModule } from '../fraud/fraud.module';
import { NotificationModule } from '../notification/notification.module';
import { PricingModule } from '../pricing/pricing.module';
import { BuyerSelfServiceService } from './buyer-self-service.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    AuthModule,
    BillingModule,
    CampaignExecutionModule,
    ChannelManagementModule,
    PricingModule,
    FraudModule,
    NotificationModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, BuyerSelfServiceService],
  exports: [OrdersService],
})
export class OrdersModule {}
