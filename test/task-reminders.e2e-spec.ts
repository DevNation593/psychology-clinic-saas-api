import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TaskRemindersService } from './../src/notifications/task-reminders.service';
import { PlatformTenantsService } from './../src/platform/platform-tenants.service';
import { createTestTenant, TEST_PASSWORD } from './helpers/create-test-tenant';

jest.setTimeout(60000);

describe('Task due reminders and notification preferences (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reminders: TaskRemindersService;
  let tenantId: string;
  let userId: string;
  let patientId: string;
  let token: string;

  const hours = (count: number) => new Date(Date.now() + count * 60 * 60 * 1000);
  const base = () => `/api/v1/tenants/${tenantId}/notifications`;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const task = (title: string, dueDate: Date) =>
    prisma.task.create({
      data: { tenantId, patientId, title, dueDate, createdById: userId },
    });
  const dueNotifications = () =>
    prisma.notificationLog.findMany({ where: { tenantId, type: 'TASK_DUE_SOON' } });

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
    reminders = app.get<TaskRemindersService>(TaskRemindersService);

    await prisma.cleanDatabase();
    tenantId = (await createTestTenant({ tenants: app.get(PlatformTenantsService), prisma }, 1)).id;
    userId = (await prisma.user.findFirstOrThrow({ where: { tenantId } })).id;
    patientId = (
      await prisma.patient.create({ data: { tenantId, firstName: 'Ana', lastName: 'Paz' } })
    ).id;

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin+1@tenant.test', password: TEST_PASSWORD })
      .expect(200);
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('notifies a task about to fall due exactly once', async () => {
    const soon = await task('Registro de pensamientos', hours(6));
    await task('Tarea lejana', hours(72));

    const first = await reminders.run();
    const second = await reminders.run();

    expect([first.taskReminders, second.taskReminders]).toEqual([1, 0]);
    const sent = await dueNotifications();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      userId,
      relatedEntityType: 'task',
      relatedEntityId: soon.id,
      status: 'SENT',
    });

    const listed = await request(app.getHttpServer()).get(base()).set(auth()).expect(200);
    expect(listed.body.map((n: { type: string }) => n.type)).toEqual(['TASK_DUE_SOON']);
  });

  it('rejects a second notification for the same key at the database level', async () => {
    const [existing] = await dueNotifications();

    await expect(
      prisma.notificationLog.create({
        data: {
          tenantId,
          userId,
          type: 'TASK_DUE_SOON',
          title: 'dup',
          body: 'dup',
          dedupeKey: existing.dedupeKey,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('stores preferences on the server and stops the reminders they turn off', async () => {
    const defaults = await request(app.getHttpServer())
      .get(`${base()}/preferences`)
      .set(auth())
      .expect(200);
    expect(defaults.body).toEqual({
      pushEnabled: true,
      appointmentReminders: true,
      taskDueReminders: true,
      morningDigest: false,
    });

    const updated = await request(app.getHttpServer())
      .put(`${base()}/preferences`)
      .set(auth())
      .send({ taskDueReminders: false })
      .expect(200);
    expect(updated.body).toMatchObject({ taskDueReminders: false, appointmentReminders: true });

    await task('No debe avisarse', hours(3));
    expect((await reminders.run()).taskReminders).toBe(0);
    expect(await dueNotifications()).toHaveLength(1);

    await request(app.getHttpServer())
      .put(`${base()}/preferences`)
      .set(auth())
      .send({ taskDueReminders: true })
      .expect(200);
    expect((await reminders.run()).taskReminders).toBe(1);
  });

  it('rejects an unknown preference', async () => {
    await request(app.getHttpServer())
      .put(`${base()}/preferences`)
      .set(auth())
      .send({ smsReminders: true })
      .expect(400);
  });

  it('reports Web Push as unavailable until VAPID keys are configured', async () => {
    const response = await request(app.getHttpServer())
      .get(`${base()}/web-push/public-key`)
      .set(auth())
      .expect(200);

    expect(response.body).toEqual({ enabled: false, publicKey: null });
  });
});
