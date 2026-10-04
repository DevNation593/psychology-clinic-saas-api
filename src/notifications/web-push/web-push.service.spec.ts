import { ConfigService } from '@nestjs/config';
import { createECDH } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { generateVapidKeys } from './web-push.crypto';
import { WebPushService, isPushServiceEndpoint } from './web-push.service';

describe('isPushServiceEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://db5p.notify.windows.com/w/?token=abc',
    'https://web.push.apple.com/abc',
  ])('accepts %s', (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com.attacker.example/abc',
    'https://attacker.example/fcm.googleapis.com',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost:5432/',
    'not a url',
  ])('rejects %s', (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(false);
  });
});

describe('WebPushService', () => {
  const vapid = generateVapidKeys();
  const config = (values: Record<string, string>) =>
    ({ get: (name: string) => values[name] }) as unknown as ConfigService;
  const configured = {
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: 'mailto:soporte@example.com',
  };
  const browser = createECDH('prime256v1');
  browser.generateKeys();
  const subscription = (id: string, endpoint: string) => ({
    id,
    endpoint,
    p256dh: browser.getPublicKey('base64url'),
    auth: Buffer.alloc(16, 5).toString('base64url'),
  });
  const prisma = {
    pushSubscription: { upsert: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn() },
  };
  const service = new WebPushService(config(configured), prisma as unknown as PrismaService);
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 201 } as Response);
  });

  afterEach(() => fetchSpy.mockRestore());

  it('exposes the public key browsers subscribe with', () => {
    expect(service.isEnabled).toBe(true);
    expect(service.publicKey).toBe(vapid.publicKey);
  });

  it('stays off and sends nothing without VAPID keys', async () => {
    const disabled = new WebPushService(config({}), prisma as unknown as PrismaService);

    expect(disabled.isEnabled).toBe(false);
    expect(disabled.publicKey).toBeNull();
    await expect(disabled.sendToUser('t', 'u', { title: 'a', body: 'b' })).resolves.toEqual({
      attempted: 0,
      delivered: 0,
    });
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
  });

  it('stores the whole subscription, one row per browser', async () => {
    await service.subscribe(
      'tenant-1',
      'user-1',
      { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'k', auth: 'a' } },
      'Chrome',
    );

    const data = {
      tenantId: 'tenant-1',
      userId: 'user-1',
      p256dh: 'k',
      auth: 'a',
      userAgent: 'Chrome',
    };
    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith({
      where: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' },
      create: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', ...data },
      update: data,
    });
  });

  it('refuses an endpoint that is not a browser push service', async () => {
    await expect(
      service.subscribe('tenant-1', 'user-1', {
        endpoint: 'https://internal.example/admin',
        keys: { p256dh: 'k', auth: 'a' },
      }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'PUSH_ENDPOINT_NOT_ALLOWED' } });
    expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled();
  });

  it('removes only the subscription of the requesting user', async () => {
    await service.unsubscribe('user-1', 'https://fcm.googleapis.com/fcm/send/abc');

    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', endpoint: 'https://fcm.googleapis.com/fcm/send/abc' },
    });
  });

  it('sends an encrypted, VAPID-signed message to every browser of the user', async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([
      subscription('s1', 'https://fcm.googleapis.com/fcm/send/abc'),
      subscription('s2', 'https://updates.push.services.mozilla.com/wpush/v2/def'),
    ]);

    const result = await service.sendToUser('tenant-1', 'user-1', {
      title: 'Actividad próxima a vencer',
      body: 'Registro de pensamientos',
      data: { url: '/patients/p1' },
    });

    expect(result).toEqual({ attempted: 2, delivered: 2 });
    expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', userId: 'user-1' },
    });
    const [url, request] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://fcm.googleapis.com/fcm/send/abc');
    expect(request.method).toBe('POST');
    expect(request.headers).toMatchObject({
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
    });
    expect(request.headers.Authorization).toMatch(
      new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`),
    );
    expect(Buffer.from(request.body).toString('latin1')).not.toContain('Registro');
  });

  it.each([404, 410])(
    'forgets a subscription the push service reports gone (%s)',
    async (status) => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        subscription('s1', 'https://fcm.googleapis.com/fcm/send/abc'),
      ]);
      fetchSpy.mockResolvedValue({ ok: false, status } as Response);

      await expect(service.sendToUser('t', 'u', { title: 'a', body: 'b' })).resolves.toEqual({
        attempted: 1,
        delivered: 0,
      });
      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: 's1' } });
    },
  );

  it('keeps the subscription after a temporary failure', async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([
      subscription('s1', 'https://fcm.googleapis.com/fcm/send/abc'),
    ]);
    fetchSpy.mockRejectedValue(new Error('timeout'));

    await expect(service.sendToUser('t', 'u', { title: 'a', body: 'b' })).resolves.toEqual({
      attempted: 1,
      delivered: 0,
    });
    expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled();
  });
});
