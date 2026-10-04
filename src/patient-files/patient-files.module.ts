import { Module } from '@nestjs/common';
import { ClinicalAccessModule } from '../clinical-access/clinical-access.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FILE_STORAGE, LocalFileStorage } from './file-storage';
import { PatientFilesController, StorageController } from './patient-files.controller';
import { PatientFilesService } from './patient-files.service';

@Module({
  imports: [PrismaModule, ClinicalAccessModule],
  controllers: [PatientFilesController, StorageController],
  providers: [PatientFilesService, { provide: FILE_STORAGE, useClass: LocalFileStorage }],
  exports: [PatientFilesService],
})
export class PatientFilesModule {}
