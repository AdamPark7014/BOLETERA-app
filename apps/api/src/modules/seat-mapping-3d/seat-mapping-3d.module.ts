import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SeatMapping3DService } from './seat-mapping-3d.service';
import { SeatMapping3DController } from './seat-mapping-3d.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SeatMapping3DController],
  providers: [SeatMapping3DService],
  exports: [SeatMapping3DService],
})
export class SeatMapping3DModule {}
