import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PlatformRoute } from '../common/decorators/platform-route.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UsersService } from '../users/users.service';

/** Legacy provider-managed professionals: approval is decided by the platform ADMIN. */
@ApiTags('platform')
@ApiBearerAuth('access-token')
@PlatformRoute()
@Roles('ADMIN')
@Controller('platform/legacy-access')
export class PlatformLegacyAccessController {
  constructor(private readonly users: UsersService) {}

  @Get('pending')
  @ApiOperation({
    summary: 'List legacy provider-managed professionals awaiting approval across all clinics',
  })
  @ApiResponse({ status: 200, description: 'List of pending professionals' })
  listPending() {
    return this.users.listPendingPsychologists();
  }

  @Post(':tenantId/:userId/grant')
  @ApiOperation({ summary: 'Grant access to a legacy provider-managed account' })
  @ApiResponse({ status: 409, description: 'PROFESSIONAL_SEAT_LIMIT_REACHED' })
  grant(@Param('tenantId') tenantId: string, @Param('userId') userId: string) {
    return this.users.grantPsychologistAccess(tenantId, userId);
  }

  @Post(':tenantId/:userId/revoke')
  @ApiOperation({ summary: 'Revoke access to a legacy provider-managed account' })
  revoke(@Param('tenantId') tenantId: string, @Param('userId') userId: string) {
    return this.users.revokePsychologistAccess(tenantId, userId);
  }
}
