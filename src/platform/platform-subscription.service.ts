import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PlanType, SubscriptionEventType, SubscriptionStatus } from '@prisma/client';
import { isPlanAllowedForTenantType } from '../common/sections/section-catalog';
import { PrismaService } from '../prisma/prisma.service';
import { runSerializableTransaction } from '../prisma/serializable-transaction';
import {
  addDays,
  addMonth,
  hasRunningPaidPeriod,
  planChangeData,
} from '../subscription/subscription-billing.rules';
import { getPlanLimits } from '../subscription/subscription-pricing';
import { ChangePlanDto } from './dto/change-plan.dto';
import {
  PlatformTenantDetail,
  PlatformTenantsService,
  TRIAL_DAYS,
  TRIAL_LIMITS,
} from './platform-tenants.service';

@Injectable()
export class PlatformSubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: PlatformTenantsService,
  ) {}

  /**
   * Moves a clinic to another plan and limits right away, with no payment. Modules (sections)
   * are never touched: they are managed apart from the plan.
   */
  async changePlan(
    tenantId: string,
    dto: ChangePlanDto,
    actorId: string,
  ): Promise<PlatformTenantDetail> {
    // Answers 404 for a missing or platform tenant before opening a transaction.
    await this.tenants.findOne(tenantId);

    await runSerializableTransaction(this.prisma, tenantId, actorId, async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId, isPlatform: false },
        select: { tenantType: true },
      });
      const subscription = await tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
      if (!tenant || !isPlanAllowedForTenantType(dto.planType, tenant.tenantType)) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'PLAN_TYPE_MISMATCH',
          message: 'El plan no corresponde al tipo de consultorio.',
        });
      }

      const isTrial = dto.planType === PlanType.TRIAL;
      const samePlan = subscription.planType === dto.planType;
      const specialtyCount = await tx.tenantSpecialty.count({ where: { tenantId } });
      const { data } = planChangeData(subscription, dto.planType, specialtyCount);

      const planSeats = isTrial ? TRIAL_LIMITS[tenant.tenantType].seats : data.seatsPsychologistsMax;
      const planPatients = isTrial
        ? TRIAL_LIMITS[tenant.tenantType].patients
        : data.maxActivePatients;
      // Staying on the same plan only adjusts what was explicitly sent.
      const seats =
        dto.seatsPsychologistsMax ?? (samePlan ? subscription.seatsPsychologistsMax : planSeats);
      const patients =
        dto.maxActivePatients ?? (samePlan ? subscription.maxActivePatients : planPatients);

      if (subscription.seatsPsychologistsUsed > seats) {
        throw new ConflictException({
          statusCode: 409,
          code: 'PLAN_BELOW_USAGE',
          message: 'El consultorio usa más cupos de psicólogos de los que permite el nuevo plan.',
          details: {
            seatsPsychologistsUsed: subscription.seatsPsychologistsUsed,
            seatsPsychologistsMax: seats,
          },
        });
      }
      if (subscription.activePatientsCount > patients) {
        throw new ConflictException({
          statusCode: 409,
          code: 'PLAN_BELOW_USAGE',
          message: 'El consultorio tiene más pacientes activos de los que permite el nuevo plan.',
          details: {
            activePatientsCount: subscription.activePatientsCount,
            maxActivePatients: patients,
          },
        });
      }

      const now = new Date();
      let period: {
        status: SubscriptionStatus;
        trialEndsAt?: Date | null;
        currentPeriodStart?: Date;
        currentPeriodEnd?: Date | null;
      };
      if (isTrial) {
        period = {
          status: SubscriptionStatus.TRIALING,
          trialEndsAt: addDays(now, TRIAL_DAYS),
          currentPeriodStart: now,
          currentPeriodEnd: null,
        };
      } else if (hasRunningPaidPeriod(subscription, now)) {
        period = { status: SubscriptionStatus.ACTIVE };
      } else {
        // Coming from a trial or a lapsed period, the paid month starts today.
        period = {
          status: SubscriptionStatus.ACTIVE,
          trialEndsAt: null,
          currentPeriodStart: now,
          currentPeriodEnd: addMonth(now),
        };
      }

      await tx.tenantSubscription.update({
        where: { tenantId },
        data: {
          ...data,
          ...period,
          seatsPsychologistsMax: seats,
          maxActivePatients: patients,
          scheduledPlanChange: null,
          scheduledPlanChangeAt: null,
        },
      });
      await tx.subscriptionPayment.updateMany({
        where: { tenantId, kind: 'PLAN_UPGRADE', status: 'PENDING' },
        data: { status: 'CANCELED' },
      });

      let eventType: SubscriptionEventType | null;
      if (samePlan) {
        eventType =
          seats > subscription.seatsPsychologistsMax
            ? SubscriptionEventType.SEATS_INCREASED
            : seats < subscription.seatsPsychologistsMax
              ? SubscriptionEventType.SEATS_DECREASED
              : null;
      } else {
        const currentPrice = Number(getPlanLimits(subscription.planType).basePrice);
        const newPrice = Number(getPlanLimits(dto.planType).basePrice);
        eventType =
          newPrice > currentPrice
            ? SubscriptionEventType.PLAN_UPGRADED
            : SubscriptionEventType.PLAN_DOWNGRADED;
      }
      if (eventType) {
        await tx.subscriptionEvent.create({
          data: {
            tenantId,
            eventType,
            previousPlan: subscription.planType,
            newPlan: dto.planType,
            previousStatus: subscription.status,
            newStatus: period.status,
            reason: dto.reason,
            metadata: {
              source: 'PLATFORM_PANEL',
              seatsPsychologistsMax: seats,
              maxActivePatients: patients,
            },
            triggeredByUserId: actorId,
          },
        });
      }
    });

    return this.tenants.findOne(tenantId);
  }
}
