import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { ProviderAdminController } from './provider-admin.controller';
import { AuthModule } from '../auth/auth.module';
import { ProfessionalProfilesModule } from '../professional-profiles/professional-profiles.module';
import { PatientTeamModule } from '../patient-team/patient-team.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [AuthModule, ProfessionalProfilesModule, PatientTeamModule, MailModule],
  controllers: [UsersController, ProviderAdminController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
