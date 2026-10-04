import { TenantSubscription } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { addMonth, planChangeData, upgradeCharge } from './subscription-billing.rules';
import { SubscriptionBillingService } from './subscription-billing.service';

describe('subscription billing rules', () => {
  it('moves to the same day of the next month and clamps short months', () => {
    expect(addMonth(new Date('2026-10-15T10:00:00Z'))).toEqual(new Date('2026-11-15T10:00:00Z'));
    expect(addMonth(new Date('2026-01-31T10:00:00Z'))).toEqual(new Date('2026-02-28T10:00:00Z'));
    expect(addMonth(new Date('2026-12-31T10:00:00Z'))).toEqual(new Date('2027-01-31T10:00:00Z'));
  });

  describe('upgradeCharge', () => {
    const period = {
      planType: 'CLINIC_BASIC' as const,
      status: 'ACTIVE' as const,
      basePrice: new Decimal(99),
      currentPeriodStart: new Date('2026-10-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-10-31T00:00:00Z'),
    };

    it('charges only the difference for the days left of a running paid period', () => {
      // 100 of difference over 30 days, 15 days left.
      expect(upgradeCharge(period, 199, new Date('2026-10-16T00:00:00Z'))).toBe(50);
    });

    it.each([
      ['a trial', { planType: 'TRIAL' as const, status: 'TRIALING' as const }],
      ['a past-due subscription', { status: 'PAST_DUE' as const }],
      ['an ended period', { currentPeriodEnd: new Date('2026-10-10T00:00:00Z') }],
      ['a subscription without period', { currentPeriodEnd: null }],
    ])('charges a full month from %s', (_label, overrides) => {
      expect(
        upgradeCharge({ ...period, ...overrides }, 199, new Date('2026-10-16T00:00:00Z')),
      ).toBe(199);
    });
  });

  describe('planChangeData', () => {
    const subscription = {
      planType: 'CLINIC_BASIC',
      featureClinicalNotes: true,
      featureSSO: true,
      featureAdvancedAnalytics: false,
    } as TenantSubscription;

    it('charges specialties above the new allowance and keeps bought add-ons on upgrade', () => {
      const { data, pricing } = planChangeData(subscription, 'CLINIC_PRO', 5);

      // 199 base + SSO add-on 20 + 2 specialties above the 3 included at 15.
      expect(pricing.totalMonthly).toBe(249);
      expect(data.basePrice.toNumber()).toBe(249);
      expect(data).toMatchObject({
        planType: 'CLINIC_PRO',
        seatsPsychologistsMax: 10,
        featureSSO: true,
        featureAdvancedAnalytics: true,
        featureWhatsAppIntegration: false,
      });
    });

    it('drops what the previous plan included and keeps bought add-ons on downgrade', () => {
      const pro = {
        planType: 'CLINIC_PRO',
        featureClinicalNotes: true,
        featureAdvancedAnalytics: true,
        featureAPIAccess: true,
        featureSSO: true,
      } as TenantSubscription;

      const { data, pricing } = planChangeData(pro, 'CLINIC_BASIC', 2);

      expect(data).toMatchObject({
        planType: 'CLINIC_BASIC',
        seatsPsychologistsMax: 3,
        featureAdvancedAnalytics: false,
        featureAPIAccess: false,
        featureSSO: true,
      });
      expect(pricing.totalMonthly).toBe(119);
    });
  });
});

describe('SubscriptionBillingService', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  let subscription: Record<string, any>;
  let payments: Record<string, any>[];
  let events: Record<string, any>[];
  let tenantType: string;

  const matches = (row: Record<string, any>, where: Record<string, any>) =>
    Object.entries(where).every(([key, value]) =>
      value && typeof value === 'object' && 'not' in value
        ? row[key] !== value.not
        : row[key] === value,
    );
  const tx = {
    tenantSubscription: {
      findUnique: jest.fn(async () => ({ ...subscription })),
      findUniqueOrThrow: jest.fn(async () => ({ ...subscription })),
      update: jest.fn(async ({ data }) => Object.assign(subscription, data)),
    },
    tenant: {
      findUnique: jest.fn(async () => ({ tenantType })),
      update: jest.fn(async ({ data }) => (tenantType = data.tenantType)),
    },
    tenantSpecialty: { count: jest.fn(async () => 1) },
    subscriptionEvent: { create: jest.fn(async ({ data }) => events.push(data)) },
    subscriptionPayment: {
      create: jest.fn(async ({ data }) => {
        const row = {
          id: `pay-${payments.length + 1}`,
          status: 'PENDING',
          provider: 'MANUAL',
          ...data,
        };
        payments.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const rows = payments.filter((row) => matches(row, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      }),
      findUnique: jest.fn(async ({ where }) => payments.find((row) => row.id === where.id) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }) => ({
        ...payments.find((row) => row.id === where.id)!,
      })),
      findFirst: jest.fn(async ({ where }) => payments.find((row) => matches(row, where)) ?? null),
      update: jest.fn(async ({ where, data }) =>
        Object.assign(payments.find((row) => row.id === where.id)!, data),
      ),
    },
  };
  const prisma = {
    ...tx,
    applyRlsContext: jest.fn(),
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const service = new SubscriptionBillingService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(now);
    tenantType = 'CLINIC';
    payments = [];
    events = [];
    subscription = {
      tenantId: 'tenant-1',
      planType: 'TRIAL',
      status: 'TRIALING',
      basePrice: new Decimal(0),
      currency: 'USD',
      currentPeriodStart: new Date('2026-10-10T00:00:00Z'),
      currentPeriodEnd: null,
      trialEndsAt: new Date('2026-10-24T00:00:00Z'),
      featureClinicalNotes: true,
      scheduledPlanChange: null,
    };
  });

  afterEach(() => jest.useRealTimers());

  describe('requestUpgrade', () => {
    it('records a pending payment and leaves the plan untouched', async () => {
      const result = await service.requestUpgrade('tenant-1', 'master', 'CLINIC_BASIC');

      expect(result).toMatchObject({
        status: 'PENDING_PAYMENT',
        currentPlan: 'TRIAL',
        requestedPlan: 'CLINIC_BASIC',
      });
      expect(payments).toEqual([
        expect.objectContaining({
          kind: 'PLAN_UPGRADE',
          status: 'PENDING',
          targetPlan: 'CLINIC_BASIC',
          requestedById: 'master',
          expiresAt: new Date('2026-10-23T12:00:00Z'),
        }),
      ]);
      expect(Number(payments[0].amount)).toBe(99);
      expect(tx.tenantSubscription.update).not.toHaveBeenCalled();
      expect(subscription).toMatchObject({ planType: 'TRIAL', status: 'TRIALING' });
      expect(events).toEqual([]);
    });

    it('replaces an earlier request instead of leaving two payable', async () => {
      await service.requestUpgrade('tenant-1', 'master', 'CLINIC_BASIC');
      await service.requestUpgrade('tenant-1', 'master', 'CLINIC_PRO');

      expect(payments.map(({ status, targetPlan }) => [status, targetPlan])).toEqual([
        ['CANCELED', 'CLINIC_BASIC'],
        ['PENDING', 'CLINIC_PRO'],
      ]);
    });

    it('rejects a plan that is not an upgrade', async () => {
      subscription.planType = 'CLINIC_PRO';

      await expect(
        service.requestUpgrade('tenant-1', 'master', 'CLINIC_BASIC'),
      ).rejects.toMatchObject({ status: 400 });
      expect(payments).toEqual([]);
    });
  });

  describe('confirmPayment', () => {
    const confirm = (reference = 'TRF-1', id = 'pay-1') =>
      service.confirmPayment(id, 'support', { reference });

    beforeEach(async () => {
      await service.requestUpgrade('tenant-1', 'master', 'CLINIC_BASIC');
    });

    it('activates the paid plan and starts its first month', async () => {
      const result = await confirm();

      expect(result.alreadyConfirmed).toBe(false);
      expect(subscription).toMatchObject({
        planType: 'CLINIC_BASIC',
        status: 'ACTIVE',
        seatsPsychologistsMax: 3,
        currentPeriodStart: now,
        currentPeriodEnd: new Date('2026-11-16T12:00:00Z'),
      });
      expect(payments[0]).toMatchObject({
        status: 'CONFIRMED',
        providerReference: 'TRF-1',
        resolvedById: 'support',
        resolvedAt: now,
      });
      expect(events.map(({ eventType }) => eventType)).toEqual([
        'PLAN_UPGRADED',
        'PAYMENT_SUCCEEDED',
      ]);
    });

    it('keeps the dates of a running paid period', async () => {
      Object.assign(subscription, {
        planType: 'PERSONAL_PRO',
        status: 'ACTIVE',
        basePrice: new Decimal(59),
        currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
      });

      await confirm();

      expect(subscription.currentPeriodEnd).toEqual(new Date('2026-11-01T00:00:00Z'));
      expect(subscription.planType).toBe('CLINIC_BASIC');
    });

    it('applies the same confirmation only once', async () => {
      await confirm();
      const updates = tx.tenantSubscription.update.mock.calls.length;

      const repeated = await confirm();

      expect(repeated).toMatchObject({ success: true, alreadyConfirmed: true });
      expect(tx.tenantSubscription.update).toHaveBeenCalledTimes(updates);
      expect(events).toHaveLength(2);
    });

    it('refuses a second, different reference for a confirmed payment', async () => {
      await confirm();

      await expect(confirm('TRF-2')).rejects.toMatchObject({
        status: 409,
        response: { code: 'PAYMENT_ALREADY_CONFIRMED' },
      });
    });

    it('refuses a reference that already confirmed another payment', async () => {
      payments.push({
        id: 'other',
        tenantId: 'tenant-2',
        status: 'CONFIRMED',
        provider: 'MANUAL',
        providerReference: 'TRF-1',
      });

      await expect(confirm()).rejects.toMatchObject({
        status: 409,
        response: { code: 'PAYMENT_REFERENCE_ALREADY_USED' },
      });
      expect(subscription.planType).toBe('TRIAL');
    });

    it('translates a unique-index collision into the same conflict', async () => {
      prisma.$transaction.mockRejectedValueOnce({ code: 'P2002' });

      await expect(confirm()).rejects.toMatchObject({
        response: { code: 'PAYMENT_REFERENCE_ALREADY_USED' },
      });
    });

    it.each(['CANCELED', 'EXPIRED', 'REJECTED'])('does not apply a %s payment', async (status) => {
      payments[0].status = status;

      await expect(confirm()).rejects.toMatchObject({
        status: 409,
        response: { code: 'PAYMENT_NOT_PENDING' },
      });
      expect(subscription).toMatchObject({ planType: 'TRIAL', status: 'TRIALING' });
    });

    it('does not apply an upgrade the tenant has already outgrown', async () => {
      subscription.planType = 'CLINIC_PRO';

      await expect(confirm()).rejects.toMatchObject({
        response: { code: 'PAYMENT_NO_LONGER_APPLICABLE' },
      });
      expect(payments[0].status).toBe('PENDING');
    });

    it('returns 404 for an unknown payment', async () => {
      await expect(confirm('TRF-1', 'missing')).rejects.toMatchObject({ status: 404 });
    });

    it('extends the period and reactivates on a renewal', async () => {
      Object.assign(subscription, { planType: 'CLINIC_BASIC', status: 'PAST_DUE' });
      payments.push({
        id: 'renewal',
        tenantId: 'tenant-1',
        kind: 'RENEWAL',
        status: 'PENDING',
        provider: 'MANUAL',
        amount: new Decimal(99),
        targetPlan: 'CLINIC_BASIC',
        periodStart: new Date('2026-10-10T00:00:00Z'),
        periodEnd: new Date('2026-11-10T00:00:00Z'),
      });

      await confirm('TRF-9', 'renewal');

      expect(subscription).toMatchObject({
        planType: 'CLINIC_BASIC',
        status: 'ACTIVE',
        currentPeriodStart: new Date('2026-10-10T00:00:00Z'),
        currentPeriodEnd: new Date('2026-11-10T00:00:00Z'),
      });
      expect(events.map(({ eventType }) => eventType)).toEqual([
        'SUBSCRIPTION_REACTIVATED',
        'PAYMENT_SUCCEEDED',
      ]);
    });
  });

  describe('rejectPayment', () => {
    it('closes the request without changing the plan, and is repeatable', async () => {
      await service.requestUpgrade('tenant-1', 'master', 'CLINIC_BASIC');

      await service.rejectPayment('pay-1', 'support', 'Sin transferencia');
      await service.rejectPayment('pay-1', 'support', 'Sin transferencia');

      expect(payments[0]).toMatchObject({
        status: 'REJECTED',
        resolutionNote: 'Sin transferencia',
      });
      expect(subscription.planType).toBe('TRIAL');
      expect(events.map(({ eventType }) => eventType)).toEqual(['PAYMENT_FAILED']);
    });
  });
});
