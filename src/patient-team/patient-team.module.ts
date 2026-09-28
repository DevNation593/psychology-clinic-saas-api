import { Module } from '@nestjs/common';
import { ProfessionalEligibilityService } from './professional-eligibility.service';

@Module({
  providers: [ProfessionalEligibilityService],
  exports: [ProfessionalEligibilityService],
})
export class PatientTeamModule {}
