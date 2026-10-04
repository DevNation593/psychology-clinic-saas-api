import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SESSION_ROUTE_KEY } from '../decorators/session-route.decorator';

/**
 * Blocks users holding a temporary password from every route except session routes
 * (logout, password change) until they choose a new password.
 */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SESSION_ROUTE_KEY, targets)) return true;

    const user = context.switchToHttp().getRequest().user;
    if (user?.mustChangePassword === true) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Debes cambiar tu contraseña temporal antes de continuar.',
      });
    }

    return true;
  }
}
