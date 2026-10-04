import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { REQUIRE_FEATURE_KEY } from '../decorators/require-feature.decorator';
import { PLATFORM_ROUTE_KEY } from '../decorators/platform-route.decorator';
import { SESSION_ROUTE_KEY } from '../decorators/session-route.decorator';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.getAllAndOverride<string>(REQUIRE_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredFeature) {
      return true; // No feature requirement
    }

    // Platform routes act on the platform tenant; session routes (logout, password change)
    // must stay reachable for every role even when the clinic lacks the feature.
    const skipped = [PLATFORM_ROUTE_KEY, SESSION_ROUTE_KEY].some((key) =>
      this.reflector.getAllAndOverride<boolean>(key, [context.getHandler(), context.getClass()]),
    );
    if (skipped) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.tenantId) {
      return false;
    }

    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId: user.tenantId },
    });

    if (!subscription) {
      throw new ForbiddenException({
        error: 'FEATURE_NOT_AVAILABLE',
        message: 'No se encontró una suscripción para el consultorio.',
        feature: requiredFeature,
      });
    }

    const configuredModules = await this.prisma.tenantModule.findMany({
      where: {
        tenantId: user.tenantId,
        moduleKey: requiredFeature,
      },
      select: { enabled: true },
    });

    // New modular tenants override legacy subscription flags. Tenants without
    // a module row continue using the existing subscription feature flags.
    if (configuredModules.length > 0) {
      if (!configuredModules.some(({ enabled }) => enabled)) {
        throw new ForbiddenException({
          error: 'MODULE_NOT_AVAILABLE',
          message: 'Este módulo no está habilitado para el consultorio.',
          feature: requiredFeature,
          currentPlan: subscription.planType,
        });
      }

      return true;
    }

    const featureKey =
      `feature${requiredFeature.charAt(0).toUpperCase()}${requiredFeature.slice(1)}` as keyof typeof subscription;
    const hasFeature = subscription[featureKey] === true;

    if (!hasFeature) {
      throw new ForbiddenException({
        error: 'FEATURE_NOT_AVAILABLE',
        message: `This feature requires a higher plan. Please upgrade.`,
        feature: requiredFeature,
        currentPlan: subscription.planType,
        upgradeUrl: `/tenants/${user.tenantId}/subscription/upgrade`,
      });
    }

    return true;
  }
}
