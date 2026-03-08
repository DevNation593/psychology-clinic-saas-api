import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpgradePlanDto } from './dto/upgrade-plan.dto';
import { DowngradePlanDto } from './dto/downgrade-plan.dto';
import { CustomizeFeaturesDto } from './dto/customize-features.dto';
import { TenantType } from '@prisma/client';

@ApiTags('Subscription')
@ApiBearerAuth()
@Controller('tenants/:tenantId/subscription')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get()
  @ApiOperation({ summary: 'Get current subscription details' })
  async getCurrentSubscription(@Param('tenantId') tenantId: string) {
    return this.subscriptionService.getCurrentSubscription(tenantId);
  }

  @Get('usage')
  @ApiOperation({ summary: 'Get usage metrics and limits' })
  async getUsageMetrics(@Param('tenantId') tenantId: string) {
    return this.subscriptionService.getUsageMetrics(tenantId);
  }

  @Post('upgrade')
  @Roles('CLIENTE')
  @ApiOperation({ summary: 'Upgrade subscription plan (CLIENTE only)' })
  async upgradePlan(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: any,
    @Body() dto: UpgradePlanDto,
  ) {
    return this.subscriptionService.upgradePlan(tenantId, user.userId, dto.newPlan);
  }

  @Post('downgrade')
  @Roles('CLIENTE')
  @ApiOperation({ summary: 'Schedule downgrade (CLIENTE only)' })
  async downgradePlan(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: any,
    @Body() dto: DowngradePlanDto,
  ) {
    return this.subscriptionService.downgradePlan(tenantId, user.userId, dto.newPlan);
  }

  @Post('features')
  @Roles('CLIENTE')
  @ApiOperation({
    summary: 'Customize subscription modules/features (CLIENTE only)',
    description:
      'Select which modules to enable. Modules included in the plan are free; others are billed as addons.',
  })
  async customizeFeatures(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: any,
    @Body() dto: CustomizeFeaturesDto,
  ) {
    return this.subscriptionService.customizeFeatures(tenantId, user.userId, dto.modules);
  }

  @Get('plans')
  @ApiOperation({
    summary: 'Get available plans catalog with pricing and module details',
  })
  @ApiQuery({ name: 'tenantType', enum: ['PERSONAL', 'CLINIC'], required: false })
  async getAvailablePlans(@Query('tenantType') tenantType?: TenantType) {
    return this.subscriptionService.getAvailablePlans(tenantType);
  }
}
