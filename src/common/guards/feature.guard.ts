import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { REQUIRE_FEATURE_KEY } from '../decorators/require-feature.decorator';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.get<string>(REQUIRE_FEATURE_KEY, context.getHandler());

    if (!requiredFeature) {
      return true; // No feature requirement
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.tenantId) {
      return false;
    }

    // SOPORTE bypasses feature checks
    if (user.role === 'SOPORTE') {
      return true;
    }

    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId: user.tenantId },
    });

    if (!subscription) {
      return false;
    }

    const configuredModules = await this.prisma.tenantModule.findMany({
      where: {
        tenantId: user.tenantId,
        moduleKey: { in: [requiredFeature, `core.${requiredFeature}`] },
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
