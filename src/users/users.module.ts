import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UserPermissionsController } from './user-permissions.controller';
import { UserPermissionsService } from './user-permissions.service';
import { AuthModule } from '../auth/auth.module';
import { ProfessionalProfilesModule } from '../professional-profiles/professional-profiles.module';
import { PatientTeamModule } from '../patient-team/patient-team.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [AuthModule, ProfessionalProfilesModule, PatientTeamModule, MailModule],
  controllers: [UsersController, UserPermissionsController],
  providers: [UsersService, UserPermissionsService],
  exports: [UsersService],
})
export class UsersModule {}
