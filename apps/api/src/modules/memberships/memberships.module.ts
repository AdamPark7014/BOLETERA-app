import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentModule } from '../payment/payment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MembershipBuyerController } from './membership-buyer.controller';
import { MembershipCheckoutService } from './membership-checkout.service';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';

@Module({
  imports: [PrismaModule, AuthModule, PaymentModule],
  controllers: [MembershipBuyerController, MembershipsController],
  providers: [MembershipsService, MembershipCheckoutService],
  exports: [MembershipsService, MembershipCheckoutService],
})
export class MembershipsModule {}
