import { Module } from '@nestjs/common';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionBillingService } from './subscription-billing.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { SubscriptionPaymentsController } from './subscription-payments.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SubscriptionController, SubscriptionPaymentsController],
  providers: [SubscriptionService, SubscriptionBillingService, SubscriptionLifecycleService],
  exports: [SubscriptionService, SubscriptionBillingService],
})
export class SubscriptionModule {}
