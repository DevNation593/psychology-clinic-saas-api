import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentTemplatesController } from './document-templates.controller';
import { DocumentTemplatesService } from './document-templates.service';

@Module({
  imports: [PrismaModule],
  controllers: [DocumentTemplatesController],
  providers: [DocumentTemplatesService],
})
export class DocumentTemplatesModule {}
