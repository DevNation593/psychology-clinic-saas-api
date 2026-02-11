import { Controller, Get, Post, Body, Patch, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { CreateTenantDto, UpdateTenantDto, CompleteOnboardingDto } from './dto/tenant.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Public()
  @Post()
  @ApiOperation({ summary: 'Create new tenant (clinic) - Public endpoint for signup' })
  @ApiResponse({ status: 201, description: 'Tenant created successfully' })
  @ApiResponse({ status: 409, description: 'Tenant slug or email already exists' })
  async create(@Body() createTenantDto: CreateTenantDto) {
    return this.tenantsService.create(createTenantDto);
  }

  @ApiBearerAuth('access-token')
  @Get(':tenantId')
  @ApiOperation({ summary: 'Get tenant details' })
  @ApiResponse({ status: 200, description: 'Tenant found' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async findOne(@Param('tenantId') tenantId: string) {
    return this.tenantsService.findOne(tenantId);
  }

  @ApiBearerAuth('access-token')
  @Roles('TENANT_ADMIN')
  @Patch(':tenantId')
  @ApiOperation({ summary: 'Update tenant - Admin only' })
  @ApiResponse({ status: 200, description: 'Tenant updated' })
  async update(@Param('tenantId') tenantId: string, @Body() updateTenantDto: UpdateTenantDto) {
    return this.tenantsService.update(tenantId, updateTenantDto);
  }

  @ApiBearerAuth('access-token')
  @Roles('TENANT_ADMIN')
  @Post(':tenantId/complete-onboarding')
  @ApiOperation({ summary: 'Mark onboarding as completed - Admin only' })
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
