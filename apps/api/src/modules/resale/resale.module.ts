import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentModule } from '../payment/payment.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { ResaleService } from './resale.service';
import { ResaleCheckoutService } from './resale-checkout.service';
import { ResaleSellerPayoutService } from './resale-seller-payout.service';
import { ResaleController } from './resale.controller';

@Module({
  imports: [PrismaModule, PaymentModule, forwardRef(() => WaitlistModule)],
  controllers: [ResaleController],
  providers: [ResaleService, ResaleCheckoutService, ResaleSellerPayoutService],
  exports: [ResaleService, ResaleSellerPayoutService],
})
export class ResaleModule {}
