import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { ProviderAdminController } from './provider-admin.controller';
import { AuthModule } from '../auth/auth.module';
import { ProfessionalProfilesModule } from '../professional-profiles/professional-profiles.module';

@Module({
  imports: [AuthModule, ProfessionalProfilesModule],
  controllers: [UsersController, ProviderAdminController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
