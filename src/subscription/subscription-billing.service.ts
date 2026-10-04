import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PlanType,
  Prisma,
  SubscriptionPayment,
  SubscriptionPaymentStatus,
  TenantSubscription,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { runSerializableTransaction } from '../prisma/serializable-transaction';
import {
  BILLING_RULES,
  addDays,
  addMonth,
  hasRunningPaidPeriod,
  isUpgrade,
  planChangeData,
  upgradeCharge,
} from './subscription-billing.rules';

const conflict = (code: string, message: string) =>
  new ConflictException({ statusCode: 409, code, message });

/**
 * Charges of the subscription. A paid plan is never enabled by asking for it: the request
 * becomes a PENDING payment and the plan changes only when that payment is confirmed.
 * Confirmation is manual today (support, with the reference of the transfer or receipt);
 * a payment provider's webhook can call `confirmPayment` with its own provider name.
 */
@Injectable()
export class SubscriptionBillingService {
  constructor(private readonly prisma: PrismaService) {}

  async requestUpgrade(tenantId: string, userId: string, newPlan: PlanType) {
    const now = new Date();

    return runSerializableTransaction(this.prisma, tenantId, userId, async (tx) => {
      const subscription = await tx.tenantSubscription.findUnique({ where: { tenantId } });
      if (!subscription) throw new BadRequestException('Suscripción no encontrada');

      await this.assertUpgradeAllowed(tx, subscription, newPlan);

      const specialtyCount = await tx.tenantSpecialty.count({ where: { tenantId } });
      const { pricing } = planChangeData(subscription, newPlan, specialtyCount);
      const amount = upgradeCharge(subscription, pricing.totalMonthly, now);

      // A newer request replaces the previous one: only one upgrade can be waiting for payment.
      await tx.subscriptionPayment.updateMany({
        where: { tenantId, kind: 'PLAN_UPGRADE', status: 'PENDING' },
        data: {
          status: 'CANCELED',
          resolvedAt: now,
          resolutionNote: 'Reemplazada por una solicitud más reciente',
        },
      });

      const payment = await tx.subscriptionPayment.create({
        data: {
          tenantId,
          kind: 'PLAN_UPGRADE',
          amount: new Decimal(amount),
          currency: subscription.currency,
          targetPlan: newPlan,
          requestedById: userId,
          expiresAt: addDays(now, BILLING_RULES.upgradeRequestExpiryDays),
        },
      });

      return {
        success: true,
        status: 'PENDING_PAYMENT' as const,
        currentPlan: subscription.planType,
        requestedPlan: newPlan,
        payment,
        pricing,
        message:
          'Solicitud registrada. El plan se activará cuando se confirme el pago; hasta entonces su plan actual no cambia.',
      };
    });
  }

  listForTenant(tenantId: string) {
    return this.prisma.subscriptionPayment.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  listAll(status?: SubscriptionPaymentStatus) {
    return this.prisma.subscriptionPayment.findMany({
      where: status ? { status } : {},
      include: { tenant: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Applies a payment exactly once. Repeating the call with the same reference returns the
   * stored result without touching the subscription again.
   */
  async confirmPayment(
    paymentId: string,
    actorId: string | null,
    input: { reference: string; note?: string; provider?: string },
  ) {
    const found = await this.prisma.subscriptionPayment.findUnique({ where: { id: paymentId } });
    if (!found) throw new NotFoundException('Pago no encontrado');
    const provider = input.provider ?? found.provider;
    const now = new Date();

    try {
      return await runSerializableTransaction(
        this.prisma,
        found.tenantId,
        actorId ?? '',
        async (tx) => {
          const payment = await tx.subscriptionPayment.findUniqueOrThrow({
            where: { id: paymentId },
          });

          if (payment.status === 'CONFIRMED') {
            if (payment.provider === provider && payment.providerReference === input.reference) {
              return { success: true, alreadyConfirmed: true, payment };
            }
            throw conflict(
              'PAYMENT_ALREADY_CONFIRMED',
              'Este pago ya fue confirmado con otra referencia.',
            );
          }
          if (payment.status !== 'PENDING') {
            throw conflict(
              'PAYMENT_NOT_PENDING',
              `El pago está ${payment.status} y ya no se puede confirmar.`,
            );
          }

          const reused = await tx.subscriptionPayment.findFirst({
            where: { provider, providerReference: input.reference, id: { not: paymentId } },
            select: { id: true },
          });
          if (reused) throw this.referenceAlreadyUsed();

          const subscription = await tx.tenantSubscription.findUniqueOrThrow({
            where: { tenantId: payment.tenantId },
          });
          const updated =
            payment.kind === 'PLAN_UPGRADE'
              ? await this.applyUpgrade(tx, subscription, payment, actorId, now)
              : await this.applyRenewal(tx, subscription, payment, actorId);

          const confirmed = await tx.subscriptionPayment.update({
            where: { id: paymentId },
            data: {
              status: 'CONFIRMED',
              provider,
              providerReference: input.reference,
              resolvedById: actorId,
              resolvedAt: now,
              resolutionNote: input.note,
            },
          });

          await tx.subscriptionEvent.create({
            data: {
              tenantId: payment.tenantId,
              eventType: 'PAYMENT_SUCCEEDED',
              previousStatus: subscription.status,
              newStatus: updated.status,
              metadata: {
                paymentId,
                kind: payment.kind,
                amount: Number(payment.amount),
                provider,
                reference: input.reference,
              },
              triggeredByUserId: actorId,
            },
          });

          return {
            success: true,
            alreadyConfirmed: false,
            payment: confirmed,
            subscription: updated,
          };
        },
      );
    } catch (error) {
      // Two confirmations racing with the same reference: the unique index decides.
      if ((error as { code?: string }).code === 'P2002') throw this.referenceAlreadyUsed();
      throw error;
    }
  }

  async rejectPayment(paymentId: string, actorId: string, reason: string) {
    const found = await this.prisma.subscriptionPayment.findUnique({ where: { id: paymentId } });
    if (!found) throw new NotFoundException('Pago no encontrado');

    return runSerializableTransaction(this.prisma, found.tenantId, actorId, async (tx) => {
      const payment = await tx.subscriptionPayment.findUniqueOrThrow({ where: { id: paymentId } });
      if (payment.status === 'REJECTED') return { success: true, payment };
      if (payment.status !== 'PENDING') {
        throw conflict(
          'PAYMENT_NOT_PENDING',
          `El pago está ${payment.status} y ya no se puede rechazar.`,
        );
      }

      const rejected = await tx.subscriptionPayment.update({
        where: { id: paymentId },
        data: {
          status: 'REJECTED',
          resolvedById: actorId,
          resolvedAt: new Date(),
          resolutionNote: reason,
        },
      });
      await tx.subscriptionEvent.create({
        data: {
          tenantId: payment.tenantId,
          eventType: 'PAYMENT_FAILED',
          reason,
          metadata: { paymentId, kind: payment.kind, amount: Number(payment.amount) },
          triggeredByUserId: actorId,
        },
      });

      return { success: true, payment: rejected };
    });
  }

  private async assertUpgradeAllowed(
    tx: Prisma.TransactionClient,
    subscription: TenantSubscription,
    newPlan: PlanType,
  ) {
    if (!isUpgrade(subscription.planType, newPlan)) {
      throw new BadRequestException('Esto no es una mejora. Use downgradePlan para degradaciones.');
    }
    const tenant = await tx.tenant.findUnique({ where: { id: subscription.tenantId } });
    if (newPlan.startsWith('PERSONAL_') && tenant?.tenantType === 'CLINIC') {
      throw new BadRequestException(
        'No se puede cambiar a un plan personal en una cuenta de clínica.',
      );
    }
    return tenant;
  }

  private async applyUpgrade(
    tx: Prisma.TransactionClient,
    subscription: TenantSubscription,
    payment: SubscriptionPayment,
    actorId: string | null,
    now: Date,
  ) {
    const newPlan = payment.targetPlan;
    if (!isUpgrade(subscription.planType, newPlan)) {
      throw conflict(
        'PAYMENT_NO_LONGER_APPLICABLE',
        'El plan del consultorio cambió desde que se solicitó esta mejora. Rechace este pago y solicite una nueva.',
      );
    }
    const tenant = await this.assertUpgradeAllowed(tx, subscription, newPlan);
    if (newPlan.startsWith('CLINIC_') && tenant?.tenantType === 'PERSONAL') {
      await tx.tenant.update({
        where: { id: subscription.tenantId },
        data: { tenantType: 'CLINIC' },
      });
    }

    const specialtyCount = await tx.tenantSpecialty.count({
      where: { tenantId: subscription.tenantId },
    });
    const { data } = planChangeData(subscription, newPlan, specialtyCount);
    // Coming from a trial or an unpaid period, the paid month starts with the payment.
    const period = hasRunningPaidPeriod(subscription, now)
      ? {}
      : { currentPeriodStart: now, currentPeriodEnd: addMonth(now) };

    const updated = await tx.tenantSubscription.update({
      where: { tenantId: subscription.tenantId },
      data: {
        ...data,
        ...period,
        status: 'ACTIVE',
        scheduledPlanChange: null,
        scheduledPlanChangeAt: null,
      },
    });

    await tx.subscriptionEvent.create({
      data: {
        tenantId: subscription.tenantId,
        eventType: 'PLAN_UPGRADED',
        previousPlan: subscription.planType,
        newPlan,
        previousStatus: subscription.status,
        newStatus: 'ACTIVE',
        metadata: { paymentId: payment.id, amount: Number(payment.amount) },
        triggeredByUserId: actorId,
      },
    });

    return updated;
  }

  private async applyRenewal(
    tx: Prisma.TransactionClient,
    subscription: TenantSubscription,
    payment: SubscriptionPayment,
    actorId: string | null,
  ) {
    const updated = await tx.tenantSubscription.update({
      where: { tenantId: subscription.tenantId },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: payment.periodStart ?? subscription.currentPeriodStart,
        currentPeriodEnd: payment.periodEnd,
      },
    });

    if (subscription.status !== 'ACTIVE') {
      await tx.subscriptionEvent.create({
        data: {
          tenantId: subscription.tenantId,
          eventType: 'SUBSCRIPTION_REACTIVATED',
          previousStatus: subscription.status,
          newStatus: 'ACTIVE',
          metadata: { paymentId: payment.id },
          triggeredByUserId: actorId,
        },
      });
    }

    return updated;
  }

  private referenceAlreadyUsed() {
    return conflict(
      'PAYMENT_REFERENCE_ALREADY_USED',
      'Esa referencia ya se usó para confirmar otro pago.',
    );
  }
}
