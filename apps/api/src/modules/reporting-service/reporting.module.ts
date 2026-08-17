import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportingService } from './reporting.service';
import { ReportingController } from './reporting.controller';

@Module({
  // AuthModule provee los guards que usa el controller, incluido StreamAuthGuard
  // y su StreamTicketService: sin importarlo, Nest intenta resolverlos en el
  // contexto de este módulo y falla al arrancar.
  imports: [PrismaModule, AuthModule],
  controllers: [ReportingController],
  providers: [ReportingService],
  exports: [ReportingService]
})
export class ReportingModule {}


