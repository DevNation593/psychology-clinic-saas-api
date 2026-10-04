import { Controller, Get, Post, Body, Patch, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { UpdateTenantDto } from './dto/tenant.dto';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @ApiBearerAuth('access-token')
  @Get(':tenantId')
  @ApiOperation({ summary: 'Get tenant details' })
  @ApiResponse({ status: 200, description: 'Tenant found' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async findOne(@Param('tenantId') tenantId: string) {
    return this.tenantsService.findOne(tenantId);
  }

  @ApiBearerAuth('access-token')
  @Roles('MASTER')
  @Patch(':tenantId')
  @ApiOperation({ summary: 'Update tenant - Master only' })
  @ApiResponse({ status: 200, description: 'Tenant updated' })
  async update(@Param('tenantId') tenantId: string, @Body() updateTenantDto: UpdateTenantDto) {
    return this.tenantsService.update(tenantId, updateTenantDto);
  }

  @ApiBearerAuth('access-token')
  @Roles('MASTER')
  @Post(':tenantId/complete-onboarding')
  @ApiOperation({ summary: 'Mark onboarding as completed - Master only' })
  @ApiResponse({ status: 200, description: 'Onboarding completed' })
  async completeOnboarding(@Param('tenantId') tenantId: string) {
    return this.tenantsService.completeOnboarding(tenantId);
  }

  @ApiBearerAuth('access-token')
  @Get(':tenantId/subscription')
  @ApiOperation({ summary: 'Get tenant subscription details' })
  @ApiResponse({ status: 200, description: 'Subscription found' })
  async getSubscription(@Param('tenantId') tenantId: string) {
    return this.tenantsService.getSubscription(tenantId);
  }
}
