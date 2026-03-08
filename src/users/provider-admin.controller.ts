import { Controller, Get, Post, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('provider-admin')
@ApiBearerAuth('access-token')
@Controller('admin/psychologists')
export class ProviderAdminController {
  constructor(private readonly usersService: UsersService) {}

  @Roles('SOPORTE')
  @Get('pending')
  @ApiOperation({
    summary: 'List all pending psychologists across all clinics (Provider/OWNER only)',
    description: 'Returns psychologists awaiting provider approval in clinic tenants.',
  })
  @ApiResponse({ status: 200, description: 'List of pending psychologists' })
  async listPending() {
    return this.usersService.listPendingPsychologists();
  }

  @Roles('SOPORTE')
  @Post(':tenantId/:userId/grant-access')
  @ApiOperation({
    summary: 'Grant psychologist access from admin panel (Provider/OWNER only)',
  })
  @ApiResponse({ status: 200, description: 'Access granted' })
  async grantAccess(@Param('tenantId') tenantId: string, @Param('userId') userId: string) {
    return this.usersService.grantPsychologistAccess(tenantId, userId);
  }

  @Roles('SOPORTE')
  @Post(':tenantId/:userId/revoke-access')
  @ApiOperation({
    summary: 'Revoke psychologist access from admin panel (Provider/OWNER only)',
  })
  @ApiResponse({ status: 200, description: 'Access revoked' })
  async revokeAccess(@Param('tenantId') tenantId: string, @Param('userId') userId: string) {
    return this.usersService.revokePsychologistAccess(tenantId, userId);
  }
}
