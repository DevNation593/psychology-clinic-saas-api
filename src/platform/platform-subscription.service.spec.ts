import { Prisma } from '@prisma/client';
import { getPlanFeatureFlags, getPlanLimits } from '../subscription/subscription-pricing';
import { PlatformSubscriptionService } from './platform-subscription.service';

const ACTOR = 'admin-1';
const TENANT = 'tenant-1';

function subscriptionOf(planType: any, overrides: Record<string, unknown> = {}) {
  const limits = getPlanLimits(planType);
  return {
    tenantId: TENANT,
    planType,
    status: 'ACTIVE',
    trialEndsAt: null,
    currentPeriodStart: new Date('2026-09-20T00:00:00Z'),
    currentPeriodEnd: new Date('2026-10-20T00:00:00Z'),
    basePrice: limits.basePrice,
    pricePerSeat: limits.pricePerSeat,
    seatsPsychologistsMax: limits.seatsIncluded,
    seatsPsychologistsUsed: 1,
    maxActivePatients: limits.maxActivePatients,
    activePatientsCount: 5,
    storageGB: limits.storageGB,
    monthlyNotificationsLimit: limits.monthlyNotificationsLimit,
    includedSpecialties: limits.includedSpecialties,
    specialtyPrice: limits.specialtyPrice,
    monthlyElectronicInvoicesLimit: limits.monthlyElectronicInvoicesLimit,
    scheduledPlanChange: null,
    scheduledPlanChangeAt: null,
    ...getPlanFeatureFlags(planType),
    ...overrides,
  };
}

describe('PlatformSubscriptionService', () => {
  let subscription: any;
  let tenantType: 'CLINIC' | 'PERSONAL';
  let updates: any[];
  let events: any[];
  let paymentUpdates: any[];
  let tenantModule: any;
  let paymentCreate: jest.Mock;
  let tenants: any;
  let prisma: any;
  let service: PlatformSubscriptionService;

  beforeEach(() => {
    subscription = subscriptionOf('CLINIC_BASIC');
    tenantType = 'CLINIC';
    updates = [];
    events = [];
    paymentUpdates = [];
    tenantModule = {
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    };
    paymentCreate = jest.fn();
    tenants = { findOne: jest.fn(async (id: string) => ({ tenant: { id } })) };
    const tx = {
      tenant: { findFirst: jest.fn(async () => ({ id: TENANT, tenantType })) },
      tenantSubscription: {
        findUniqueOrThrow: jest.fn(async () => subscription),
        update: jest.fn(async ({ data }) => {
          updates.push(data);
          subscription = { ...subscription, ...data };
          return subscription;
        }),
      },
      tenantSpecialty: { count: jest.fn(async () => 1) },
      subscriptionPayment: {
        updateMany: jest.fn(async (args) => {
          paymentUpdates.push(args);
          return { count: 1 };
        }),
        create: paymentCreate,
      },
      subscriptionEvent: { create: jest.fn(async ({ data }) => events.push(data)) },
      tenantModule,
    };
    prisma = {
      applyRlsContext: jest.fn(async () => undefined),
      $transaction: jest.fn(async (callback, options) => {
        expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return callback(tx);
      }),
    };
    service = new PlatformSubscriptionService(prisma, tenants);
  });

  const change = (dto: Record<string, unknown>) =>
    service.changePlan(TENANT, { reason: 'Acuerdo comercial', ...dto } as any, ACTOR);

  it('applies the limits, prices and feature flags of the new plan at once', async () => {
    await change({ planType: 'CLINIC_PRO' });
    const limits = getPlanLimits('CLINIC_PRO');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      planType: 'CLINIC_PRO',
      seatsPsychologistsMax: limits.seatsIncluded,
      maxActivePatients: limits.maxActivePatients,
      storageGB: limits.storageGB,
      monthlyNotificationsLimit: limits.monthlyNotificationsLimit,
      pricePerSeat: limits.pricePerSeat,
    });
    expect(Number(updates[0].basePrice)).toBeGreaterThanOrEqual(Number(limits.basePrice));
    for (const [flag, value] of Object.entries(getPlanFeatureFlags('CLINIC_PRO'))) {
      if (value) expect(updates[0][flag]).toBe(true);
    }
    expect(tenants.findOne).toHaveBeenCalledWith(TENANT);
  });

  it('lets explicit seats and patient limits override the plan values', async () => {
    await change({ planType: 'CLINIC_PRO', seatsPsychologistsMax: 7, maxActivePatients: 321 });
    expect(updates[0].seatsPsychologistsMax).toBe(7);
    expect(updates[0].maxActivePatients).toBe(321);
    expect(updates[0].planType).toBe('CLINIC_PRO');
  });

  it('rejects with PLAN_BELOW_USAGE and details when seats in use exceed the new limit', async () => {
    subscription = subscriptionOf('CLINIC_PRO', { seatsPsychologistsUsed: 4 });
    await expect(
      change({ planType: 'CLINIC_BASIC', seatsPsychologistsMax: 2 }),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        statusCode: 409,
        code: 'PLAN_BELOW_USAGE',
        details: { seatsPsychologistsUsed: 4, seatsPsychologistsMax: 2 },
      },
    });
    expect(updates).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('rejects with PLAN_BELOW_USAGE when active patients exceed the new limit', async () => {
    subscription = subscriptionOf('CLINIC_PRO', { activePatientsCount: 80 });
    await expect(change({ planType: 'CLINIC_PRO', maxActivePatients: 50 })).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'PLAN_BELOW_USAGE',
        details: { activePatientsCount: 80, maxActivePatients: 50 },
      },
    });
    expect(updates).toHaveLength(0);
  });

  it('rejects PLAN_TYPE_MISMATCH', async () => {
    await expect(change({ planType: 'PERSONAL_PRO' })).rejects.toMatchObject({
      status: 400,
      response: { statusCode: 400, code: 'PLAN_TYPE_MISMATCH' },
    });
    expect(updates).toHaveLength(0);
  });

  it('moves TRIAL to a paid plan as ACTIVE with a one month period', async () => {
    subscription = subscriptionOf('TRIAL', {
      status: 'TRIALING',
      trialEndsAt: new Date('2026-10-10T00:00:00Z'),
      currentPeriodEnd: null,
      seatsPsychologistsMax: 3,
      maxActivePatients: 20,
    });
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T10:00:00Z'));
    try {
      await change({ planType: 'CLINIC_BASIC' });
    } finally {
      jest.useRealTimers();
    }
    expect(updates[0].status).toBe('ACTIVE');
    expect(updates[0].currentPeriodStart).toEqual(new Date('2026-10-31T10:00:00Z'));
    expect(updates[0].currentPeriodEnd).toEqual(new Date('2026-11-30T10:00:00Z'));
  });

  it('uses the trial seats and patients when the target plan is TRIAL', async () => {
    await change({ planType: 'TRIAL' });
    expect(updates[0]).toMatchObject({
      planType: 'TRIAL',
      status: 'TRIALING',
      seatsPsychologistsMax: 3,
      maxActivePatients: 20,
      currentPeriodEnd: null,
    });
    expect(updates[0].trialEndsAt).toBeInstanceOf(Date);
  });

  it('clears a scheduled plan change and cancels pending upgrade payments', async () => {
    subscription = subscriptionOf('CLINIC_BASIC', {
      scheduledPlanChange: 'CLINIC_BASIC',
      scheduledPlanChangeAt: new Date('2026-10-20T00:00:00Z'),
    });
    await change({ planType: 'CLINIC_PRO' });
    expect(updates[0].scheduledPlanChange).toBeNull();
    expect(updates[0].scheduledPlanChangeAt).toBeNull();
    expect(paymentUpdates).toEqual([
      {
        where: { tenantId: TENANT, kind: 'PLAN_UPGRADE', status: 'PENDING' },
        data: { status: 'CANCELED' },
      },
    ]);
  });

  it('records PLAN_UPGRADED or PLAN_DOWNGRADED with the reason and the actor', async () => {
    await change({ planType: 'CLINIC_PRO', reason: 'Cortesía' });
    expect(events[0]).toMatchObject({
      tenantId: TENANT,
      eventType: 'PLAN_UPGRADED',
      previousPlan: 'CLINIC_BASIC',
      newPlan: 'CLINIC_PRO',
      previousStatus: 'ACTIVE',
      newStatus: 'ACTIVE',
      reason: 'Cortesía',
      triggeredByUserId: ACTOR,
    });

    await change({ planType: 'CLINIC_BASIC', reason: 'Baja pedida' });
    expect(events[1]).toMatchObject({
      eventType: 'PLAN_DOWNGRADED',
      previousPlan: 'CLINIC_PRO',
      newPlan: 'CLINIC_BASIC',
      reason: 'Baja pedida',
      triggeredByUserId: ACTOR,
    });
  });

  it('records SEATS_INCREASED or SEATS_DECREASED when only the seats change', async () => {
    await change({ planType: 'CLINIC_BASIC', seatsPsychologistsMax: 9 });
    expect(events[0]).toMatchObject({
      eventType: 'SEATS_INCREASED',
      previousPlan: 'CLINIC_BASIC',
      newPlan: 'CLINIC_BASIC',
      reason: 'Acuerdo comercial',
      triggeredByUserId: ACTOR,
    });
    expect(updates[0].seatsPsychologistsMax).toBe(9);

    await change({ planType: 'CLINIC_BASIC', seatsPsychologistsMax: 4 });
    expect(events[1]).toMatchObject({ eventType: 'SEATS_DECREASED' });
  });

  it('does not touch any TenantModule row', async () => {
    await change({ planType: 'CLINIC_PRO' });
    for (const fn of Object.values(tenantModule) as jest.Mock[]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('creates no SubscriptionPayment', async () => {
    await change({ planType: 'CLINIC_PRO' });
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing tenant before changing anything', async () => {
    tenants.findOne.mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }));
    await expect(change({ planType: 'CLINIC_PRO' })).rejects.toMatchObject({ status: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
