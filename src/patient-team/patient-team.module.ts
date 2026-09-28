import { Module } from '@nestjs/common';
import { ProfessionalEligibilityService } from './professional-eligibility.service';
import { PatientTeamController } from './patient-team.controller';
import { PatientTeamService } from './patient-team.service';

@Module({
  controllers: [PatientTeamController],
  providers: [ProfessionalEligibilityService, PatientTeamService],
  exports: [ProfessionalEligibilityService, PatientTeamService],
})
export class PatientTeamModule {}
