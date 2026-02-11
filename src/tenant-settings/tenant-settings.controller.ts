import { Controller, Get, Patch, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TenantSettingsService } from './tenant-settings.service';
import { UpdateTenantSettingsDto } from './dto/tenant-settings.dto';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('tenant-settings')
@ApiBearerAuth('access-token')
@Controller('tenants/:tenantId/settings')
export class TenantSettingsController {
  constructor(private readonly tenantSettingsService: TenantSettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get tenant settings',
    description: 'Returns working hours, appointment defaults, reminder rules, timezone, and locale.',
  })
  @ApiResponse({ status: 200, description: 'Tenant settings returned' })
  @ApiResponse({ status: 404, description: 'Settings not found' })
  async findOne(@Param('tenantId') tenantId: string) {
    return this.tenantSettingsService.findOne(tenantId);
  }

  @Roles('TENANT_ADMIN')
  @Patch()
  @ApiOperation({
    summary: 'Update tenant settings - Admin only',
    description:
      'Update working hours, appointment duration, reminder rules, timezone, locale, etc.',
  })
  @ApiResponse({ status: 200, description: 'Settings updated' })
  @ApiResponse({ status: 400, description: 'Invalid settings values' })
  @ApiResponse({ status: 404, description: 'Settings not found' })
  async update(
    @Param('tenantId') tenantId: string,
    @Body() updateDto: UpdateTenantSettingsDto,
  ) {
    return this.tenantSettingsService.update(tenantId, updateDto);
  }
}
