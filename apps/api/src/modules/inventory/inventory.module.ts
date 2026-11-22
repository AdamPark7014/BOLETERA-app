import { Module } from '@nestjs/common';
import { EventManagementModule } from '../event-management/event-management.module';
import { AuthModule } from '../auth/auth.module';
import { ChannelManagementModule } from '../channel-management/channel-management.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { InventoryController } from './inventory.controller';
import { WaitingRoomController } from './waiting-room.controller';
import { GuestSessionService } from './guest-session.service';
import { WaitingRoomService } from './waiting-room.service';
import { InventoryService } from './inventory.service';
import { BuyerRiskService } from './buyer-risk.service';
import { HumanChallengeService } from './human-challenge.service';
import { PurchaseLimitsService } from './purchase-limits.service';
import { OnsaleOpsService } from './onsale-ops.service';
import { OnsaleOpsController } from './onsale-ops.controller';

@Module({
  // AuthModule aporta JwtAuthGuard / RolesGuard / OptionalJwtAuthGuard: el canal
  // TAQUILLA y la propiedad de un hold se resuelven con el token, no con headers.
  imports: [AuthModule, ChannelManagementModule, WaitlistModule, EventManagementModule],
  controllers: [WaitingRoomController, InventoryController, OnsaleOpsController],
  providers: [
    GuestSessionService,
    WaitingRoomService,
    InventoryService,
    BuyerRiskService,
    HumanChallengeService,
    PurchaseLimitsService,
    OnsaleOpsService,
  ],
  exports: [
    WaitingRoomService,
    InventoryService,
    BuyerRiskService,
    HumanChallengeService,
    PurchaseLimitsService,
    OnsaleOpsService,
  ],
})
export class InventoryModule {}
