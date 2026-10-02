import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { RequireFeature } from '../decorators/require-feature.decorator';
import { PlatformRoute } from '../decorators/platform-route.decorator';
import { SessionRoute } from '../decorators/session-route.decorator';
import { FeatureGuard } from './feature.guard';

@RequireFeature('tasks')
class ClassLevelController {
  handler() {}
}

@RequireFeature('tasks')
@PlatformRoute()
class GatedPlatformController {
  handler() {}
}

@RequireFeature('tasks')
@SessionRoute()
class GatedSessionController {
  handler() {}
}

class UngatedController {
  handler() {}
}

describe('FeatureGuard', () => {
  const prisma = {
    tenantSubscription: { findUnique: jest.fn() },
    tenantModule: { findMany: jest.fn() },
  };
  const guard = new FeatureGuard(new Reflector(), prisma as unknown as PrismaService);

  const contextFor = (controller: { prototype: { handler: () => void } }, role = 'MASTER') =>
    ({
      getHandler: () => controller.prototype.handler,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: 'user-1', tenantId: 'tenant-1', role } }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.tenantModule.findMany.mockResolvedValue([]);
  });

  it('enforces a feature declared at controller level', async () => {
    prisma.tenantSubscription.findUnique.mockResolvedValue({
      planType: 'TRIAL',
      featureTasks: false,
    });

    await expect(guard.canActivate(contextFor(ClassLevelController))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows the request when the plan includes the feature', async () => {
    prisma.tenantSubscription.findUnique.mockResolvedValue({
      planType: 'CLINIC_BASIC',
      featureTasks: true,
    });

    await expect(guard.canActivate(contextFor(ClassLevelController))).resolves.toBe(true);
  });

  it('lets a tenant module row override the subscription flag', async () => {
    prisma.tenantSubscription.findUnique.mockResolvedValue({
      planType: 'CLINIC_BASIC',
      featureTasks: true,
    });
    prisma.tenantModule.findMany.mockResolvedValue([{ enabled: false }]);

    await expect(guard.canActivate(contextFor(ClassLevelController))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('reports a missing subscription with the locked-feature code', async () => {
    prisma.tenantSubscription.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(contextFor(ClassLevelController))).rejects.toMatchObject({
      response: { error: 'FEATURE_NOT_AVAILABLE' },
    });
  });

  it('applies the subscription rules to SOPORTE', async () => {
    prisma.tenantSubscription.findUnique.mockResolvedValue({
      planType: 'TRIAL',
      featureTasks: false,
    });

    await expect(guard.canActivate(contextFor(ClassLevelController, 'SOPORTE'))).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.tenantSubscription.findUnique).toHaveBeenCalled();
  });

  it('skips the check on a platform route', async () => {
    await expect(guard.canActivate(contextFor(GatedPlatformController, 'ADMIN'))).resolves.toBe(
      true,
    );
    expect(prisma.tenantSubscription.findUnique).not.toHaveBeenCalled();
    expect(prisma.tenantModule.findMany).not.toHaveBeenCalled();
  });

  it('skips the check on a session route', async () => {
    await expect(guard.canActivate(contextFor(GatedSessionController))).resolves.toBe(true);
    expect(prisma.tenantSubscription.findUnique).not.toHaveBeenCalled();
    expect(prisma.tenantModule.findMany).not.toHaveBeenCalled();
  });

  it('skips controllers without a feature requirement', async () => {
    await expect(guard.canActivate(contextFor(UngatedController))).resolves.toBe(true);
    expect(prisma.tenantSubscription.findUnique).not.toHaveBeenCalled();
  });
});
