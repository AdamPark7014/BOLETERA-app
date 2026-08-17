import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';

// `AuditService` llega por el `CommonModule` global: la reimpresión de QR por
// ventanilla (F2-04) depende de que ese registro exista, no es decorativo.
@Module({
  imports: [PrismaModule],
  controllers: [AccessController],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}


