import { Module } from '@nestjs/common';
import { ClinicalNotesService } from './clinical-notes.service';
import { ClinicalNotesController } from './clinical-notes.controller';

@Module({
  controllers: [ClinicalNotesController],
  providers: [ClinicalNotesService],
  exports: [ClinicalNotesService],
})
export class ClinicalNotesModule {}
