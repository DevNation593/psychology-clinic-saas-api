import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpgradePlanDto } from './dto/upgrade-plan.dto';
import { DowngradePlanDto } from './dto/downgrade-plan.dto';

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
  @Roles('TENANT_ADMIN')
  @ApiOperation({ summary: 'Upgrade subscription plan (TENANT_ADMIN only)' })
  async upgradePlan(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: any,
    @Body() dto: UpgradePlanDto,
  ) {
    return this.subscriptionService.upgradePlan(tenantId, user.userId, dto.newPlan);
  }

  @Post('downgrade')
  @Roles('TENANT_ADMIN')
  @ApiOperation({ summary: 'Schedule downgrade (TENANT_ADMIN only)' })
  async downgradePlan(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: any,
    @Body() dto: DowngradePlanDto,
  ) {
    return this.subscriptionService.downgradePlan(tenantId, user.userId, dto.newPlan);
  }
}
