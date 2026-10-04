import { Module } from '@nestjs/common';
import { ClinicalAccessModule } from '../clinical-access/clinical-access.module';
import { ClinicalTimelineController } from './clinical-timeline.controller';
import { ClinicalTimelineService } from './clinical-timeline.service';

@Module({
  imports: [ClinicalAccessModule],
  controllers: [ClinicalTimelineController],
  providers: [ClinicalTimelineService],
})
export class ClinicalTimelineModule {}
