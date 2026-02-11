import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip for public routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.tenantId) {
      return true; // Let JwtAuthGuard handle this
    }

    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId: user.tenantId },
    });

    if (!subscription) {
      throw new ForbiddenException('No subscription found');
    }

    // Allow access in ACTIVE and TRIALING status
    if (subscription.status === 'ACTIVE' || subscription.status === 'TRIALING') {
      return true;
    }

    // PAST_DUE: Allow read-only access
    if (subscription.status === 'PAST_DUE') {
      const method = request.method;
      if (method === 'GET') {
        return true;
      }
      throw new ForbiddenException({
        error: 'SUBSCRIPTION_PAST_DUE',
        message: 'Your payment is past due. Please update your payment method to restore full access.',
        readOnlyMode: true,
      });
    }

    // CANCELED or UNPAID: Block all access except data export
    throw new ForbiddenException({
      error: 'SUBSCRIPTION_INACTIVE',
      message: 'Your subscription is not active. Please contact support.',
      status: subscription.status,
    });
  }
}
