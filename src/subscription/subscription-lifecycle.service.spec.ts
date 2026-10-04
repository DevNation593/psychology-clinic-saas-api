import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { SubscriptionService } from './subscription.service';

type Row = Record<string, any>;

/** Evaluates the subset of Prisma filters the lifecycle uses, over in-memory rows. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Row[]).some((option) => matches(row, option));
    const value = row[key];
    if (condition === null || typeof condition !== 'object' || condition instanceof Date) {
      return value === condition || (value instanceof Date && +value === +condition);
    }
    return Object.entries(condition as Row).every(([operator, operand]) => {
      if (operator === 'not') return value !== operand;
      if (operator === 'lte') return value !== null && value !== undefined && +value <= +operand;
      if (operator === 'gt') return Number(value) > Number(operand);
      throw new Error(`Unsupported filter ${operator}`);
    });
  });
}

function table(rows: Row[]) {
  return {
    rows,
    findMany: jest.fn(async ({ where }: { where: Row }) =>
      rows.filter((row) => matches(row, where)).map((row) => ({ ...row })),
    ),
    updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const hit = rows.filter((row) => matches(row, where));
      hit.forEach((row) => Object.assign(row, data));
      return { count: hit.length };
    }),
    update: jest.fn(async ({ where, data }: { where: Row; data: Row }) =>
      Object.assign(rows.find((row) => row.id === where.id)!, data),
    ),
  };
}

describe('SubscriptionLifecycleService', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const subscription = (id: string, overrides: Row): Row => ({
    id,
    tenantId: `tenant-${id}`,
    planType: 'CLINIC_BASIC',
    status: 'ACTIVE',
    basePrice: new Decimal(99),
    currency: 'USD',
    currentPeriodStart: day('2026-10-01'),
    currentPeriodEnd: day('2026-11-01'),
    trialEndsAt: null,
    scheduledPlanChange: null,
    scheduledPlanChangeAt: null,
    featureClinicalNotes: true,
    ...overrides,
  });

  let subscriptions: ReturnType<typeof table>;
  let payments: Row[];
  let events: Row[];
  let service: SubscriptionLifecycleService;
  const validateDowngrade = jest.fn();

  const build = (rows: Row[]) => {
    subscriptions = table(rows);
    payments = [];
    events = [];
    const paymentTable = {
      ...table(payments),
      createMany: jest.fn(async ({ data }: { data: Row[] }) => {
        const fresh = data.filter(
          (item) =>
            !payments.some(
              (row) =>
                row.tenantId === item.tenantId &&
                row.kind === item.kind &&
                +row.periodStart === +item.periodStart,
            ),
        );
        payments.push(...fresh.map((item) => ({ status: 'PENDING', ...item })));
        return { count: fresh.length };
      }),
    };
    const client = {
      tenantSubscription: subscriptions,
      subscriptionPayment: paymentTable,
      subscriptionEvent: { create: jest.fn(async ({ data }: { data: Row }) => events.push(data)) },
      tenantSpecialty: { count: jest.fn(async () => 1) },
    };
    const prisma = {
      ...client,
      $transaction: jest.fn(async (callback: (tx: typeof client) => unknown) => callback(client)),
    };
    service = new SubscriptionLifecycleService(
      prisma as unknown as PrismaService,
      { validateDowngrade } as unknown as SubscriptionService,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    validateDowngrade.mockResolvedValue({ canDowngrade: true, errors: [], warnings: [] });
  });

  describe('scheduled downgrades', () => {
    const due = () =>
      subscription('a', {
        planType: 'CLINIC_PRO',
        basePrice: new Decimal(199),
        featureAdvancedAnalytics: true,
        scheduledPlanChange: 'CLINIC_BASIC',
        scheduledPlanChangeAt: day('2026-10-16'),
        currentPeriodEnd: day('2026-12-01'),
      });

    it('applies a due downgrade exactly once', async () => {
      build([due()]);

      const first = await service.run(now);
      const second = await service.run(now);

      expect(first.downgradesApplied).toBe(1);
      expect(second.downgradesApplied).toBe(0);
      expect(subscriptions.rows[0]).toMatchObject({
        planType: 'CLINIC_BASIC',
        seatsPsychologistsMax: 3,
        featureAdvancedAnalytics: false,
        scheduledPlanChange: null,
        scheduledPlanChangeAt: null,
      });
      expect(subscriptions.rows[0].basePrice.toNumber()).toBe(99);
      expect(events.filter(({ eventType }) => eventType === 'PLAN_DOWNGRADED')).toEqual([
        expect.objectContaining({ previousPlan: 'CLINIC_PRO', newPlan: 'CLINIC_BASIC' }),
      ]);
    });

    it('does not apply it twice when another instance claimed it first', async () => {
      build([due()]);
      subscriptions.updateMany.mockResolvedValueOnce({ count: 0 });

      const report = await service.run(now);

      expect(report.downgradesApplied).toBe(0);
      expect(subscriptions.update).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    });

    it('leaves a future downgrade alone', async () => {
      build([{ ...due(), scheduledPlanChangeAt: day('2026-10-20') }]);

      expect((await service.run(now)).downgradesApplied).toBe(0);
      expect(subscriptions.rows[0].planType).toBe('CLINIC_PRO');
    });

    it('cancels a downgrade the tenant no longer fits in, and records why', async () => {
      build([due()]);
      validateDowngrade.mockResolvedValue({ canDowngrade: false, errors: ['5 profesionales'] });

      const report = await service.run(now);

      expect(report).toMatchObject({ downgradesApplied: 0, downgradesBlocked: 1 });
      expect(subscriptions.rows[0]).toMatchObject({
        planType: 'CLINIC_PRO',
        scheduledPlanChange: null,
      });
      expect(events).toEqual([
        expect.objectContaining({
          eventType: 'LIMIT_REACHED',
          metadata: { errors: ['5 profesionales'] },
        }),
      ]);
    });
  });

  describe('renewals', () => {
    it('issues one charge per period within the notice window, however often it runs', async () => {
      build([
        subscription('soon', { currentPeriodEnd: day('2026-10-20') }),
        subscription('later', { currentPeriodEnd: day('2026-11-15') }),
        subscription('trial', {
          planType: 'TRIAL',
          status: 'TRIALING',
          basePrice: new Decimal(0),
          trialEndsAt: day('2026-10-20'),
          currentPeriodEnd: null,
        }),
        subscription('custom', { planType: 'CLINIC_ENTERPRISE', basePrice: new Decimal(0) }),
      ]);

      const first = await service.run(now);
      const second = await service.run(now);

      expect([first.renewalsIssued, second.renewalsIssued]).toEqual([1, 0]);
      expect(payments).toEqual([
        expect.objectContaining({
          tenantId: 'tenant-soon',
          kind: 'RENEWAL',
          status: 'PENDING',
          targetPlan: 'CLINIC_BASIC',
          periodStart: day('2026-10-20'),
          periodEnd: day('2026-11-20'),
        }),
      ]);
      expect(Number(payments[0].amount)).toBe(99);
    });

    it('charges the next period at the price of a downgrade scheduled for its start', async () => {
      build([
        subscription('a', {
          planType: 'CLINIC_PRO',
          basePrice: new Decimal(199),
          currentPeriodEnd: day('2026-10-20'),
          scheduledPlanChange: 'CLINIC_BASIC',
          scheduledPlanChangeAt: day('2026-10-20'),
        }),
      ]);

      await service.run(now);

      expect(payments[0]).toMatchObject({ targetPlan: 'CLINIC_BASIC' });
      expect(Number(payments[0].amount)).toBe(99);
      expect(subscriptions.rows[0].planType).toBe('CLINIC_PRO');
    });
  });

  describe('expiry', () => {
    it('makes an ended trial read-only and blocks it after the grace period', async () => {
      build([
        subscription('t', {
          planType: 'TRIAL',
          status: 'TRIALING',
          basePrice: new Decimal(0),
          currentPeriodEnd: null,
          trialEndsAt: day('2026-10-16'),
        }),
      ]);

      await service.run(now);
      expect(subscriptions.rows[0].status).toBe('PAST_DUE');

      await service.run(day('2026-10-22'));
      expect(subscriptions.rows[0].status).toBe('PAST_DUE');

      const report = await service.run(day('2026-10-24'));
      expect(report.blocked).toBe(1);
      expect(subscriptions.rows[0].status).toBe('UNPAID');
      expect(events.map(({ eventType }) => eventType)).toEqual([
        'TRIAL_ENDED',
        'GRACE_PERIOD_ENDED',
      ]);
    });

    it('moves an unpaid period to past due and then to unpaid, once each', async () => {
      build([subscription('p', { currentPeriodEnd: day('2026-10-16') })]);

      const first = await service.run(now);
      const again = await service.run(now);
      await service.run(day('2026-10-24'));

      expect([first.enteredGrace, again.enteredGrace]).toEqual([1, 0]);
      expect(subscriptions.rows[0].status).toBe('UNPAID');
      expect(
        events.map(({ eventType, previousStatus, newStatus }) => [
          eventType,
          previousStatus,
          newStatus,
        ]),
      ).toEqual([
        ['GRACE_PERIOD_ENTERED', 'ACTIVE', 'PAST_DUE'],
        ['GRACE_PERIOD_ENDED', 'PAST_DUE', 'UNPAID'],
      ]);
    });

    it('leaves a subscription inside its period and a free custom plan untouched', async () => {
      build([
        subscription('ok', {}),
        subscription('custom', {
          planType: 'CLINIC_ENTERPRISE',
          basePrice: new Decimal(0),
          currentPeriodEnd: day('2026-01-01'),
        }),
      ]);

      await service.run(now);

      expect(subscriptions.rows.map(({ status }) => status)).toEqual(['ACTIVE', 'ACTIVE']);
      expect(events).toEqual([]);
    });

    it('expires an upgrade request nobody paid, without touching renewals', async () => {
      build([]);
      payments.push(
        { id: 'old', kind: 'PLAN_UPGRADE', status: 'PENDING', expiresAt: day('2026-10-15') },
        { id: 'fresh', kind: 'PLAN_UPGRADE', status: 'PENDING', expiresAt: day('2026-10-20') },
        { id: 'renewal', kind: 'RENEWAL', status: 'PENDING', expiresAt: null },
      );

      const report = await service.run(now);

      expect(report.paymentsExpired).toBe(1);
      expect(payments.map(({ status }) => status)).toEqual(['EXPIRED', 'PENDING', 'PENDING']);
    });
  });
});
