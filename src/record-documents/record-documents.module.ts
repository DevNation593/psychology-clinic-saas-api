import { Module } from '@nestjs/common';
import { ClinicalAccessModule } from '../clinical-access/clinical-access.module';
import { PatientFilesModule } from '../patient-files/patient-files.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SpecialtyRecordsModule } from '../specialty-records/specialty-records.module';
import { RecordDocumentsController } from './record-documents.controller';
import { RecordDocumentsService } from './record-documents.service';

@Module({
  imports: [PrismaModule, ClinicalAccessModule, SpecialtyRecordsModule, PatientFilesModule],
  controllers: [RecordDocumentsController],
  providers: [RecordDocumentsService],
})
export class RecordDocumentsModule {}
