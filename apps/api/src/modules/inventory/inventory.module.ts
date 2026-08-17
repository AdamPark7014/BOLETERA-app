import { Module } from '@nestjs/common';
import { EventManagementModule } from '../event-management/event-management.module';
import { AuthModule } from '../auth/auth.module';
import { ChannelManagementModule } from '../channel-management/channel-management.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { InventoryController } from './inventory.controller';
import { WaitingRoomController } from './waiting-room.controller';
import { WaitingRoomService } from './waiting-room.service';
import { InventoryService } from './inventory.service';

@Module({
  // AuthModule aporta JwtAuthGuard / RolesGuard / OptionalJwtAuthGuard: el canal
  // TAQUILLA y la propiedad de un hold se resuelven con el token, no con headers.
  imports: [AuthModule, ChannelManagementModule, WaitlistModule, EventManagementModule],
  controllers: [WaitingRoomController, InventoryController],
  providers: [WaitingRoomService, InventoryService],
  exports: [WaitingRoomService, InventoryService],
})
export class InventoryModule {}
