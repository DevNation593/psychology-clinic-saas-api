import { Module } from '@nestjs/common';
import { ProfessionalProfilesService } from './professional-profiles.service';

@Module({ providers: [ProfessionalProfilesService], exports: [ProfessionalProfilesService] })
export class ProfessionalProfilesModule {}
