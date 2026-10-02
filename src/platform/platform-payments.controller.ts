import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { PlatformRoute } from '../common/decorators/platform-route.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  ConfirmSubscriptionPaymentDto,
  ListSubscriptionPaymentsQueryDto,
  RejectSubscriptionPaymentDto,
} from '../subscription/dto/subscription-payment.dto';
import { SubscriptionBillingService } from '../subscription/subscription-billing.service';

/** The only place where a subscription payment is confirmed or rejected. */
@ApiTags('platform')
@ApiBearerAuth('access-token')
@PlatformRoute()
@Roles('ADMIN')
@Controller('platform/subscription-payments')
export class PlatformPaymentsController {
  constructor(private readonly billing: SubscriptionBillingService) {}

  @Get()
  @ApiOperation({ summary: 'List subscription payments of every tenant' })
  list(@Query() query: ListSubscriptionPaymentsQueryDto) {
    return this.billing.listAll(query.status);
  }

  @Post(':paymentId/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirm a payment and apply it',
    description:
      'Idempotent: repeating the call with the same reference returns the stored result. A reference cannot confirm two payments.',
  })
  confirm(
    @Param('paymentId') paymentId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmSubscriptionPaymentDto,
  ) {
    return this.billing.confirmPayment(paymentId, user.userId, dto);
  }

  @Post(':paymentId/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a pending payment' })
  reject(
    @Param('paymentId') paymentId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RejectSubscriptionPaymentDto,
  ) {
    return this.billing.rejectPayment(paymentId, user.userId, dto.reason);
  }
}
