import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { AllowInactiveSubscription } from '../decorators/allow-inactive-subscription.decorator';
import { PlatformRoute } from '../decorators/platform-route.decorator';
import { SessionRoute } from '../decorators/session-route.decorator';
import { SubscriptionController } from '../../subscription/subscription.controller';
import { SubscriptionGuard } from './subscription.guard';

@AllowInactiveSubscription()
class BillingController {
  handler() {}
}

@PlatformRoute()
class PlatformController {
  handler() {}
}

@SessionRoute()
class SessionController {
  handler() {}
}

class ClinicController {
  handler() {}
}

describe('SubscriptionGuard', () => {
  const prisma = { tenantSubscription: { findUnique: jest.fn() } };
  const guard = new SubscriptionGuard(new Reflector(), prisma as unknown as PrismaService);
  const contextFor = (
    controller: { prototype: { handler: () => void } },
    method: string,
    role = 'MASTER',
  ) =>
    ({
      getHandler: () => controller.prototype.handler,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => ({ method, user: { tenantId: 'tenant-1', role } }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => jest.resetAllMocks());

  it.each(['PAST_DUE', 'UNPAID', 'CANCELED'])(
    'lets a %s tenant reach the routes it needs to pay',
    async (status) => {
      prisma.tenantSubscription.findUnique.mockResolvedValue({ status });

      await expect(guard.canActivate(contextFor(BillingController, 'POST'))).resolves.toBe(true);
    },
  );

  it('keeps a past-due tenant read-only everywhere else', async () => {
    prisma.tenantSubscription.findUnique.mockResolvedValue({ status: 'PAST_DUE' });

    await expect(guard.canActivate(contextFor(ClinicController, 'GET'))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(ClinicController, 'POST'))).rejects.toMatchObject({
      response: { error: 'SUBSCRIPTION_PAST_DUE' },
    });
  });

  it('blocks an unpaid tenant everywhere else', async () => {
    prisma.tenantSubscription.findUnique.mockResolvedValue({ status: 'UNPAID' });

    await expect(guard.canActivate(contextFor(ClinicController, 'GET'))).rejects.toMatchObject({
      response: { error: 'SUBSCRIPTION_INACTIVE' },
    });
  });

  it('is what the subscription controller declares', () => {
    expect(Reflect.getMetadata('allowInactiveSubscription', SubscriptionController)).toBe(true);
  });

  it('applies the subscription rules to SOPORTE', async () => {
    prisma.tenantSubscription.findUnique.mockResolvedValue({ status: 'UNPAID' });

    await expect(
      guard.canActivate(contextFor(ClinicController, 'GET', 'SOPORTE')),
    ).rejects.toMatchObject({ response: { error: 'SUBSCRIPTION_INACTIVE' } });
    expect(prisma.tenantSubscription.findUnique).toHaveBeenCalled();
  });

  it('skips the check on a platform route', async () => {
    await expect(
      guard.canActivate(contextFor(PlatformController, 'POST', 'ADMIN')),
    ).resolves.toBe(true);
    expect(prisma.tenantSubscription.findUnique).not.toHaveBeenCalled();
  });

  it('skips the check on a session route', async () => {
    // a past-due clinic can still log out and change the password
    prisma.tenantSubscription.findUnique.mockResolvedValue({ status: 'UNPAID' });

    await expect(guard.canActivate(contextFor(SessionController, 'POST'))).resolves.toBe(true);
    expect(prisma.tenantSubscription.findUnique).not.toHaveBeenCalled();
  });
});
