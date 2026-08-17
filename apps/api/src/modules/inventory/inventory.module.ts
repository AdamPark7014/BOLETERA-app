import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChannelManagementModule } from '../channel-management/channel-management.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  // AuthModule aporta JwtAuthGuard / RolesGuard / OptionalJwtAuthGuard: el canal
  // TAQUILLA y la propiedad de un hold se resuelven con el token, no con headers.
  imports: [AuthModule, ChannelManagementModule, WaitlistModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
