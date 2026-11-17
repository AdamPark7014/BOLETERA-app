import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentModule } from '../payment/payment.module';
import { ResaleService } from './resale.service';
import { ResaleCheckoutService } from './resale-checkout.service';
import { ResaleController } from './resale.controller';

@Module({
  imports: [PrismaModule, PaymentModule],
  controllers: [ResaleController],
  providers: [ResaleService, ResaleCheckoutService],
  exports: [ResaleService],
})
export class ResaleModule {}
