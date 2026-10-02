import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AuthService } from './../src/auth/auth.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { SubscriptionLifecycleService } from './../src/subscription/subscription-lifecycle.service';
import { TenantsService } from './../src/tenants/tenants.service';
import { createTestTenant, TEST_PASSWORD } from './helpers/create-test-tenant';

jest.setTimeout(60000);

describe('Subscription billing (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let lifecycle: SubscriptionLifecycleService;
  let tenantId: string;
  let masterToken: string;
  let supportToken: string;
  let paymentId: string;

  const login = async (email: string) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return response.body.accessToken as string;
  };
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const subscription = () => prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
  const days = (count: number) => new Date(Date.now() + count * 24 * 60 * 60 * 1000);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
    lifecycle = app.get<SubscriptionLifecycleService>(SubscriptionLifecycleService);

    await prisma.cleanDatabase();
    const tenants = app.get<TenantsService>(TenantsService);
    tenantId = (await createTestTenant(tenants, 1)).id;
    const supportTenantId = (await createTestTenant(tenants, 2)).id;
    await prisma.user.create({
      data: {
        tenantId: supportTenantId,
        email: 'support@tenant.test',
        password: await app.get<AuthService>(AuthService).hashPassword(TEST_PASSWORD),
        firstName: 'Support',
        lastName: 'Desk',
        role: 'SOPORTE',
        isActive: true,
      },
    });

    masterToken = await login('admin+1@tenant.test');
    supportToken = await login('support@tenant.test');
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts on a trial', async () => {
    expect(await subscription()).toMatchObject({ planType: 'TRIAL', status: 'TRIALING' });
  });

  it('records an upgrade request without enabling the paid plan', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantId}/subscription/upgrade`)
      .set(bearer(masterToken))
      .send({ newPlan: 'CLINIC_BASIC' })
      .expect(201);

    paymentId = response.body.payment.id;
    expect(response.body).toMatchObject({
      status: 'PENDING_PAYMENT',
      payment: { status: 'PENDING', kind: 'PLAN_UPGRADE', targetPlan: 'CLINIC_BASIC' },
    });
    expect(Number(response.body.payment.amount)).toBe(99);
    expect(await subscription()).toMatchObject({
      planType: 'TRIAL',
      status: 'TRIALING',
      seatsPsychologistsMax: 1,
    });

    const listed = await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenantId}/subscription/payments`)
      .set(bearer(masterToken))
      .expect(200);
    expect(listed.body.map((payment: { id: string }) => payment.id)).toEqual([paymentId]);
  });

  it('does not let the tenant confirm its own payment', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/subscription-payments/${paymentId}/confirm`)
      .set(bearer(masterToken))
      .send({ reference: 'SELF-1' })
      .expect(403);
    expect((await subscription()).planType).toBe('TRIAL');
  });

  it('activates the plan when support confirms, and only once', async () => {
    const confirm = () =>
      request(app.getHttpServer())
        .post(`/api/v1/subscription-payments/${paymentId}/confirm`)
        .set(bearer(supportToken))
        .send({ reference: 'TRF-0001' })
        .expect(200);

    const first = await confirm();
    expect(first.body.alreadyConfirmed).toBe(false);
    const active = await subscription();
    expect(active).toMatchObject({
      planType: 'CLINIC_BASIC',
      status: 'ACTIVE',
      seatsPsychologistsMax: 3,
    });
    expect(Number(active.basePrice)).toBe(99);
    expect(active.currentPeriodEnd!.getTime()).toBeGreaterThan(days(27).getTime());

    const second = await confirm();
    expect(second.body.alreadyConfirmed).toBe(true);
    expect((await subscription()).updatedAt).toEqual(active.updatedAt);

    const events = await prisma.subscriptionEvent.findMany({
      where: { tenantId, eventType: { in: ['PLAN_UPGRADED', 'PAYMENT_SUCCEEDED'] } },
    });
    expect(events).toHaveLength(2);
  });

  it('refuses to reuse the reference of a confirmed payment', async () => {
    const upgrade = await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantId}/subscription/upgrade`)
      .set(bearer(masterToken))
      .send({ newPlan: 'CLINIC_PRO' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/subscription-payments/${upgrade.body.payment.id}/confirm`)
      .set(bearer(supportToken))
      .send({ reference: 'TRF-0001' })
      .expect(409);
    expect(response.body.code).toBe('PAYMENT_REFERENCE_ALREADY_USED');
    expect((await subscription()).planType).toBe('CLINIC_BASIC');

    await request(app.getHttpServer())
      .post(`/api/v1/subscription-payments/${upgrade.body.payment.id}/reject`)
      .set(bearer(supportToken))
      .send({ reason: 'Referencia repetida' })
      .expect(200);
  });

  it('applies a scheduled downgrade once when it falls due', async () => {
    await prisma.tenantSubscription.update({
      where: { tenantId },
      data: { scheduledPlanChange: 'PERSONAL_BASIC', scheduledPlanChangeAt: days(-1) },
    });
    // The fixture is a clinic; the plan data is what this test is about.
    const first = await lifecycle.run();
    const second = await lifecycle.run();

    expect([first.downgradesApplied, second.downgradesApplied]).toEqual([1, 0]);
    const current = await subscription();
    expect(current).toMatchObject({
      planType: 'PERSONAL_BASIC',
      scheduledPlanChange: null,
      scheduledPlanChangeAt: null,
    });
    expect(Number(current.basePrice)).toBe(29);
    expect(
      await prisma.subscriptionEvent.count({
        where: { tenantId, eventType: 'PLAN_DOWNGRADED' },
      }),
    ).toBe(1);
  });

  it('issues one renewal, then restricts and blocks an unpaid subscription', async () => {
    await prisma.tenantSubscription.update({
      where: { tenantId },
      data: { currentPeriodStart: days(-27), currentPeriodEnd: days(3) },
    });
    await lifecycle.run();
    await lifecycle.run();
    const renewals = await prisma.subscriptionPayment.findMany({
      where: { tenantId, kind: 'RENEWAL' },
    });
    expect(renewals).toHaveLength(1);
    expect(renewals[0]).toMatchObject({ status: 'PENDING', targetPlan: 'PERSONAL_BASIC' });
    expect(Number(renewals[0].amount)).toBe(29);

    await lifecycle.run(days(4));
    expect((await subscription()).status).toBe('PAST_DUE');
    // Read-only, but the subscription routes stay reachable so the tenant can pay.
    await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantId}/patients`)
      .set(bearer(masterToken))
      .send({ firstName: 'Ana', lastName: 'Paciente' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenantId}/subscription/payments`)
      .set(bearer(masterToken))
      .expect(200);

    await lifecycle.run(days(11));
    expect((await subscription()).status).toBe('UNPAID');

    await request(app.getHttpServer())
      .post(`/api/v1/subscription-payments/${renewals[0].id}/confirm`)
      .set(bearer(supportToken))
      .send({ reference: 'TRF-0002' })
      .expect(200);
    const renewed = await subscription();
    expect(renewed.status).toBe('ACTIVE');
    expect(renewed.currentPeriodEnd).toEqual(renewals[0].periodEnd);
  });
});
