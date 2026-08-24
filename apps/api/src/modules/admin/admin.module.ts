import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { PaymentModule } from '../payment/payment.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule, PaymentModule, NotificationModule, ReconciliationModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
