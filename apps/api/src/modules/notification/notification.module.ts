import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { MailService } from './mail.service';
import { NOTIFICATION_QUEUE, NotificationService } from './notification.service';
import { NotificationProcessor } from './notification.processor';
import { TicketPdfService } from './ticket-pdf.service';

@Module({
  imports: [ConfigModule, PrismaModule, BullModule.registerQueue({ name: NOTIFICATION_QUEUE })],
  providers: [NotificationService, NotificationProcessor, MailService, TicketPdfService],
  exports: [NotificationService, TicketPdfService],
})
export class NotificationModule {}
