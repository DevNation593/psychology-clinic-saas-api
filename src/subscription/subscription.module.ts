import { Module } from '@nestjs/common';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionBillingService } from './subscription-billing.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';

@Module({
  imports: [PrismaModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, SubscriptionBillingService, SubscriptionLifecycleService],
  exports: [SubscriptionService, SubscriptionBillingService],
})
export class SubscriptionModule {}
