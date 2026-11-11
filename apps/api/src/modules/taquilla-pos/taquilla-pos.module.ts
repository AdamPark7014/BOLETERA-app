import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersModule } from '../orders/orders.module';
import { TaquillaPosService } from './taquilla-pos.service';
import { TaquillaPosController } from './taquilla-pos.controller';

@Module({
  imports: [PrismaModule, InventoryModule, OrdersModule],
  controllers: [TaquillaPosController],
  providers: [TaquillaPosService],
  exports: [TaquillaPosService],
})
export class TaquillaPosModule {}
