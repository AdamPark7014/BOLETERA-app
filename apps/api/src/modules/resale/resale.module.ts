import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ResaleService } from './resale.service';
import { ResaleController } from './resale.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ResaleController],
  providers: [ResaleService],
  exports: [ResaleService],
})
export class ResaleModule {}
