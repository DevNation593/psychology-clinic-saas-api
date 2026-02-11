import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * TenantGuard ensures that users can only access resources within their own tenant.
 * It validates that the tenantId in the URL/body matches the user's tenantId from JWT.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.tenantId) {
      throw new ForbiddenException('Tenant context not found');
    }

    // Check tenantId in params (e.g., /tenants/:tenantId/users)
    const tenantIdFromParams = request.params?.tenantId;
    
    // Check tenantId in body (for POST/PUT requests)
    const tenantIdFromBody = request.body?.tenantId;

    // If tenantId is provided in params, validate it
    if (tenantIdFromParams) {
      if (tenantIdFromParams !== user.tenantId) {
        throw new ForbiddenException('Access denied: Tenant mismatch');
      }
    }

    // If tenantId is provided in body, validate and ensure it matches
    if (tenantIdFromBody) {
      if (tenantIdFromBody !== user.tenantId) {
        throw new ForbiddenException('Access denied: Cannot create resources for another tenant');
      }
    }

    // Inject user's tenantId into the request for convenience
    request.tenantId = user.tenantId;

    return true;
  }
}
