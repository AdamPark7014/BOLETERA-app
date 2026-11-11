import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VenueLayoutModule } from '../venue-layout/venue-layout.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LayoutManagementService } from './layout-management.service';
import { LayoutManagementController } from './layout-management.controller';

@Module({
  imports: [PrismaModule, VenueLayoutModule, InventoryModule],
  controllers: [LayoutManagementController],
  providers: [LayoutManagementService],
  exports: [LayoutManagementService],
})
export class LayoutManagementModule {}
