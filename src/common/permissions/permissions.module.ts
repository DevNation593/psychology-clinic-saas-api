import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PermissionChecker } from './permission-checker.service';

/** Global so the permission guard and any controller can ask whether a permission was withdrawn. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [PermissionChecker],
  exports: [PermissionChecker],
})
export class PermissionsModule {}
