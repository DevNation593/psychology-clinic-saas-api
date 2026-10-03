import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Prisma,
  SubscriptionEventType,
  SubscriptionStatus,
  TenantSubscription,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BILLING_RULES, addDays, addMonth, planChangeData } from './subscription-billing.rules';
import { getPlanLimits } from './subscription-pricing';
import { SubscriptionService } from './subscription.service';

export type LifecycleReport = {
  downgradesApplied: number;
  downgradesBlocked: number;
  paymentsExpired: number;
  renewalsIssued: number;
  enteredGrace: number;
  blocked: number;
};

/**
 * Keeps subscriptions in step with time: scheduled downgrades, renewal charges and the
 * states that follow an unpaid period. Every step claims its row with a conditional update,
 * so running twice, or on two instances at once, changes nothing the second time.
 */
@Injectable()
export class SubscriptionLifecycleService {
  private readonly logger = new Logger(SubscriptionLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    try {
      const report = await this.run();
      if (Object.values(report).some((count) => count > 0)) {
        this.logger.log(`Subscription lifecycle: ${JSON.stringify(report)}`);
      }
    } catch (error) {
      this.logger.error('Subscription lifecycle run failed', (error as Error).stack);
    }
  }

  async run(now: Date = new Date()): Promise<LifecycleReport> {
    // Downgrades first, so the renewal of the next period is charged at the new price.
    const downgrades = await this.applyScheduledDowngrades(now);
    const paymentsExpired = await this.expireUpgradeRequests(now);
    const renewalsIssued = await this.issueRenewals(now);
    const enteredGrace = await this.enterGracePeriod(now);
    const blocked = await this.endGracePeriod(now);

    return { ...downgrades, paymentsExpired, renewalsIssued, enteredGrace, blocked };
  }

  private async applyScheduledDowngrades(now: Date) {
    const due = await this.prisma.tenantSubscription.findMany({
      where: { scheduledPlanChange: { not: null }, scheduledPlanChangeAt: { lte: now } },
    });
    let downgradesApplied = 0;
    let downgradesBlocked = 0;

    for (const subscription of due) {
      const newPlan = subscription.scheduledPlanChange!;
      // The limits were checked when the downgrade was requested; usage may have grown since.
      const validation = await this.subscriptions.validateDowngrade(
        subscription.tenantId,
        getPlanLimits(newPlan),
      );

      const applied = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.tenantSubscription.updateMany({
          where: {
            id: subscription.id,
            scheduledPlanChange: newPlan,
            scheduledPlanChangeAt: subscription.scheduledPlanChangeAt,
          },
          data: { scheduledPlanChange: null, scheduledPlanChangeAt: null },
        });
        if (claimed.count === 0) return null;

        if (!validation.canDowngrade) {
          await tx.subscriptionEvent.create({
            data: {
              tenantId: subscription.tenantId,
              eventType: 'LIMIT_REACHED',
              previousPlan: subscription.planType,
              newPlan,
              reason: 'La degradación programada no se aplicó: el uso supera los límites del plan.',
              metadata: { errors: validation.errors },
            },
          });
          return false;
        }

        const specialtyCount = await tx.tenantSpecialty.count({
          where: { tenantId: subscription.tenantId },
        });
        await tx.tenantSubscription.update({
          where: { id: subscription.id },
          data: planChangeData(subscription, newPlan, specialtyCount).data,
        });
        await tx.subscriptionEvent.create({
          data: {
            tenantId: subscription.tenantId,
            eventType: 'PLAN_DOWNGRADED',
            previousPlan: subscription.planType,
            newPlan,
            metadata: { applied: true, scheduledFor: subscription.scheduledPlanChangeAt },
          },
        });
        return true;
      });

      if (applied === true) downgradesApplied += 1;
      if (applied === false) downgradesBlocked += 1;
    }

    return { downgradesApplied, downgradesBlocked };
  }

  private async expireUpgradeRequests(now: Date): Promise<number> {
    const expired = await this.prisma.subscriptionPayment.updateMany({
      where: { status: 'PENDING', kind: 'PLAN_UPGRADE', expiresAt: { lte: now } },
      data: {
        status: 'EXPIRED',
        resolvedAt: now,
        resolutionNote: 'No se confirmó el pago a tiempo',
      },
    });
    return expired.count;
  }

  /** One charge per tenant and period: the unique index absorbs repeated runs. */
  private async issueRenewals(now: Date): Promise<number> {
    const renewing = await this.prisma.tenantSubscription.findMany({
      where: {
        status: 'ACTIVE',
        planType: { not: 'TRIAL' },
        basePrice: { gt: 0 },
        currentPeriodEnd: { not: null, lte: addDays(now, BILLING_RULES.renewalNoticeDays) },
      },
    });
    let issued = 0;

    for (const subscription of renewing) {
      const periodStart = subscription.currentPeriodEnd!;
      const { planType, amount } = await this.nextPeriodCharge(subscription, periodStart);
      if (amount <= 0) continue;

      const result = await this.prisma.subscriptionPayment.createMany({
        data: [
          {
            tenantId: subscription.tenantId,
            kind: 'RENEWAL',
            amount: new Prisma.Decimal(amount),
            currency: subscription.currency,
            targetPlan: planType,
            periodStart,
            periodEnd: addMonth(periodStart),
          },
        ],
        skipDuplicates: true,
      });
      issued += result.count;
    }

    return issued;
  }

  /** A downgrade scheduled for the end of this period lowers what the next one costs. */
  private async nextPeriodCharge(subscription: TenantSubscription, periodStart: Date) {
    const scheduled = subscription.scheduledPlanChange;
    if (
      !scheduled ||
      !subscription.scheduledPlanChangeAt ||
      subscription.scheduledPlanChangeAt > periodStart
    ) {
      return { planType: subscription.planType, amount: Number(subscription.basePrice) };
    }

    const specialtyCount = await this.prisma.tenantSpecialty.count({
      where: { tenantId: subscription.tenantId },
    });
    return {
      planType: scheduled,
      amount: planChangeData(subscription, scheduled, specialtyCount).pricing.totalMonthly,
    };
  }

  /** An ended trial or an unpaid period leaves the account read-only. */
  private async enterGracePeriod(now: Date): Promise<number> {
    const [expiredTrials, unpaidPeriods] = await Promise.all([
      this.prisma.tenantSubscription.findMany({
        where: { status: 'TRIALING', trialEndsAt: { lte: now } },
        select: { id: true, tenantId: true },
      }),
      this.prisma.tenantSubscription.findMany({
        where: {
          status: 'ACTIVE',
          planType: { not: 'TRIAL' },
          basePrice: { gt: 0 },
          currentPeriodEnd: { not: null, lte: now },
        },
        select: { id: true, tenantId: true },
      }),
    ]);

    let moved = 0;
    for (const row of expiredTrials) {
      moved += await this.transition(row, 'TRIALING', 'PAST_DUE', 'TRIAL_ENDED');
    }
    for (const row of unpaidPeriods) {
      moved += await this.transition(row, 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD_ENTERED');
    }
    return moved;
  }

  private async endGracePeriod(now: Date): Promise<number> {
    const limit = addDays(now, -BILLING_RULES.graceDays);
    const overdue = await this.prisma.tenantSubscription.findMany({
      where: {
        status: 'PAST_DUE',
        OR: [
          { planType: 'TRIAL', trialEndsAt: { lte: limit } },
          { planType: { not: 'TRIAL' }, currentPeriodEnd: { not: null, lte: limit } },
        ],
      },
      select: { id: true, tenantId: true },
    });

    let moved = 0;
    for (const row of overdue) {
      moved += await this.transition(row, 'PAST_DUE', 'UNPAID', 'GRACE_PERIOD_ENDED');
    }
    return moved;
  }

  /** Moves one subscription between states and records it, only if it is still in `from`. */
  private async transition(
    row: { id: string; tenantId: string },
    from: SubscriptionStatus,
    to: SubscriptionStatus,
    eventType: SubscriptionEventType,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.tenantSubscription.updateMany({
        where: { id: row.id, status: from },
        data: { status: to },
      });
      if (claimed.count === 0) return 0;

      await tx.subscriptionEvent.create({
        data: { tenantId: row.tenantId, eventType, previousStatus: from, newStatus: to },
      });
      return 1;
    });
  }
}
