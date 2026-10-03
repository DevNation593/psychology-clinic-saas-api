import { PlanType, TenantSubscription } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  SPECIALTY_PRICE_PER_MONTH,
  calculateSubscriptionPrice,
  getPlanFeatureFlags,
  getPlanIncludedModules,
  getPlanLimits,
  getSelectedModules,
  moduleToDbKey,
} from './subscription-pricing';

const DAY_MS = 24 * 60 * 60 * 1000;

export const BILLING_RULES = {
  /** An upgrade request that nobody paid stops being payable after this many days. */
  upgradeRequestExpiryDays: 7,
  /** The renewal charge is issued this many days before the period ends. */
  renewalNoticeDays: 7,
  /** Read-only days after an unpaid period or trial ends, before access is blocked. */
  graceDays: 7,
} as const;

export const PLAN_HIERARCHY: PlanType[] = [
  'TRIAL',
  'PERSONAL_BASIC',
  'PERSONAL_PRO',
  'CLINIC_BASIC',
  'CLINIC_PRO',
  'CLINIC_ENTERPRISE',
];

export const isUpgrade = (from: PlanType, to: PlanType) =>
  PLAN_HIERARCHY.indexOf(to) > PLAN_HIERARCHY.indexOf(from);

export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

/** Same day next month, clamped to the last day when that month is shorter (Jan 31 -> Feb 28). */
export function addMonth(date: Date): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  if (next.getUTCDate() !== date.getUTCDate()) next.setUTCDate(0);
  return next;
}

type PeriodFields = Pick<
  TenantSubscription,
  'planType' | 'status' | 'currentPeriodStart' | 'currentPeriodEnd'
>;

/** A paid period that has not ended yet: an upgrade inside it is prorated and keeps its dates. */
export function hasRunningPaidPeriod(subscription: PeriodFields, now: Date): boolean {
  return (
    subscription.planType !== 'TRIAL' &&
    subscription.status === 'ACTIVE' &&
    !!subscription.currentPeriodEnd &&
    subscription.currentPeriodEnd > now
  );
}

/**
 * What an upgrade costs today: the difference for the days left when a paid period is
 * running, a full month otherwise (trial, expired or unpaid subscription).
 */
export function upgradeCharge(
  subscription: PeriodFields & Pick<TenantSubscription, 'basePrice'>,
  newMonthlyPrice: number,
  now: Date,
): number {
  if (!hasRunningPaidPeriod(subscription, now)) return newMonthlyPrice;

  const start = subscription.currentPeriodStart.getTime();
  const end = subscription.currentPeriodEnd!.getTime();
  const totalDays = Math.max(1, Math.ceil((end - start) / DAY_MS));
  const daysRemaining = Math.min(totalDays, Math.ceil((end - now.getTime()) / DAY_MS));
  const difference = newMonthlyPrice - Number(subscription.basePrice);

  return Math.max(0, Math.round((difference / totalDays) * daysRemaining * 100) / 100);
}

/**
 * The subscription columns of a plan change. An upgrade keeps every module the tenant already
 * has; a downgrade keeps only the add-ons that were bought on top of the previous plan.
 */
export function planChangeData(
  subscription: TenantSubscription,
  newPlan: PlanType,
  specialtyCount: number,
) {
  const limits = getPlanLimits(newPlan);
  const current = getSelectedModules(subscription);
  const previousPlanModules = getPlanIncludedModules(subscription.planType);
  const kept = isUpgrade(subscription.planType, newPlan)
    ? current
    : current.filter((module) => !previousPlanModules.includes(module));
  const selectedModules = [...new Set([...getPlanIncludedModules(newPlan), ...kept])];

  const featureFlags = getPlanFeatureFlags(newPlan);
  for (const module of selectedModules) featureFlags[moduleToDbKey(module)] = true;

  const pricing = calculateSubscriptionPrice({
    planType: newPlan,
    selectedModules,
    specialtyCount,
    specialtyUnitPrice: Number(limits.specialtyPrice),
  });

  return {
    pricing,
    data: {
      planType: newPlan,
      basePrice: new Decimal(pricing.totalMonthly),
      pricePerSeat: limits.pricePerSeat,
      seatsPsychologistsMax: limits.seatsIncluded,
      maxActivePatients: limits.maxActivePatients,
      storageGB: limits.storageGB,
      monthlyNotificationsLimit: limits.monthlyNotificationsLimit,
      includedSpecialties: limits.includedSpecialties,
      specialtyPrice: new Decimal(SPECIALTY_PRICE_PER_MONTH),
      monthlyElectronicInvoicesLimit: limits.monthlyElectronicInvoicesLimit,
      ...featureFlags,
    },
  };
}
