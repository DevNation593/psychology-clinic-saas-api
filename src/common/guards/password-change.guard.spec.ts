import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from '../decorators/public.decorator';
import { SessionRoute } from '../decorators/session-route.decorator';
import { PasswordChangeGuard } from './password-change.guard';

class ClinicController {
  handler() {}
}

@SessionRoute()
class SessionController {
  handler() {}
}

@Public()
class PublicController {
  handler() {}
}

describe('PasswordChangeGuard', () => {
  const guard = new PasswordChangeGuard(new Reflector());
  const contextFor = (
    controller: { prototype: { handler: () => void } },
    user?: Record<string, unknown>,
  ) =>
    ({
      getHandler: () => controller.prototype.handler,
      getClass: () => controller,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  it('lets a user without the flag through', () => {
    const user = { userId: 'u', tenantId: 't', role: 'MASTER', mustChangePassword: false };
    expect(guard.canActivate(contextFor(ClinicController, user))).toBe(true);
  });

  it('blocks a flagged user with PASSWORD_CHANGE_REQUIRED', () => {
    const user = { userId: 'u', tenantId: 't', role: 'MASTER', mustChangePassword: true };
    let caught: unknown;
    try {
      guard.canActivate(contextFor(ClinicController, user));
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      status: 403,
      response: {
        statusCode: 403,
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Debes cambiar tu contraseña temporal antes de continuar.',
      },
    });
  });

  it('lets a flagged user reach a session route', () => {
    const user = { userId: 'u', tenantId: 't', role: 'MASTER', mustChangePassword: true };
    expect(guard.canActivate(contextFor(SessionController, user))).toBe(true);
  });

  it('lets public routes through', () => {
    expect(guard.canActivate(contextFor(PublicController, undefined))).toBe(true);
  });
});
