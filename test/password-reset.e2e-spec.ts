import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { MailService } from './../src/mail/mail.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { PlatformTenantsService } from './../src/platform/platform-tenants.service';
import { createTestTenant, TEST_PASSWORD } from './helpers/create-test-tenant';

jest.setTimeout(60000);

/** The whole recovery flow over HTTP, reading the link from the outgoing message, never from logs. */
describe('Password reset (E2E)', () => {
  let app: INestApplication;
  let fetchSpy: jest.SpyInstance;
  const email = 'admin+1@tenant.test';
  const newPassword = 'Recovered456!';

  const post = (path: string, body: object) =>
    request(app.getHttpServer()).post(`/api/v1/auth/${path}`).send(body);
  const outbox = () =>
    fetchSpy.mock.calls
      .filter(([url]) => url === 'https://mail.example.test/send')
      .map(([, init]) => JSON.parse(init.body));
  const tokenFrom = (message: { text: string }) =>
    decodeURIComponent(/reset-password\?token=(\S+)/.exec(message.text)![1]);
  // The message is sent without blocking the response.
  const waitForMail = async (count: number) => {
    for (let attempt = 0; attempt < 50 && outbox().length < count; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return outbox();
  };

  beforeAll(async () => {
    process.env.EMAIL_API_URL = 'https://mail.example.test/send';
    process.env.EMAIL_FROM = 'PsyClinic <no-reply@example.test>';
    process.env.FRONTEND_URL = 'https://app.example.test';
    const realFetch = global.fetch;
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation((input, init) =>
        input === 'https://mail.example.test/send'
          ? Promise.resolve({ ok: true, status: 200 } as Response)
          : realFetch(input, init),
      );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    expect(app.get(MailService).isConfigured).toBe(true);

    const prisma = app.get<PrismaService>(PrismaService);
    await prisma.cleanDatabase();
    await createTestTenant({ tenants: app.get(PlatformTenantsService), prisma }, 1);
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    await app.close();
  });

  it('answers the same for an unknown address and sends nothing', async () => {
    const response = await post('forgot-password', { email: 'nobody@tenant.test' }).expect(200);

    expect(response.body.message).toBe('If the account exists, a reset link has been sent');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(outbox()).toEqual([]);
  });

  it('mails a link that restores access, exactly once', async () => {
    await post('forgot-password', { email }).expect(200);
    const [message] = await waitForMail(1);

    expect(message).toMatchObject({
      to: email,
      from: 'PsyClinic <no-reply@example.test>',
      subject: 'Restablece tu contraseña de PsyClinic',
    });
    expect(message.text).toContain('https://app.example.test/reset-password?token=');
    const token = tokenFrom(message);

    await post('reset-password', { token, password: newPassword }).expect(200);

    await post('login', { email, password: TEST_PASSWORD }).expect(401);
    await post('login', { email, password: newPassword }).expect(200);

    // The link stops working once it has been used.
    await post('reset-password', { token, password: 'Another789!' }).expect(400);
    await post('login', { email, password: newPassword }).expect(200);
  });

  it('rejects a link that was not issued by the API', async () => {
    await post('reset-password', { token: 'not-a-token', password: 'Another789!' }).expect(400);
  });
});
