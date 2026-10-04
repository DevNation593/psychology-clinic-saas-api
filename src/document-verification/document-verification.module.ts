import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentVerificationController } from './document-verification.controller';
import { DocumentVerificationService } from './document-verification.service';

@Module({
  imports: [PrismaModule],
  controllers: [DocumentVerificationController],
  providers: [DocumentVerificationService],
})
export class DocumentVerificationModule {}
