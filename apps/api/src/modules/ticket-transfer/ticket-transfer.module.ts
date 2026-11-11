import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { TicketTransferController } from './ticket-transfer.controller';
import { TicketTransferService } from './ticket-transfer.service';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [TicketTransferController],
  providers: [TicketTransferService],
  exports: [TicketTransferService],
})
export class TicketTransferModule {}
