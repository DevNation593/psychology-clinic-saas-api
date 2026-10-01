import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

function setup(role: string | undefined, requiredRoles?: string[], isPublic = false) {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
    if (key === IS_PUBLIC_KEY) return isPublic;
    if (key === ROLES_KEY) return requiredRoles;
    return undefined;
  });

  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
  } as unknown as ExecutionContext;

  return { guard: new RolesGuard(reflector), context };
}

describe('RolesGuard', () => {
  it.each([
    ['ADMIN', 'CLIENTE'],
    ['CLIENTE', 'ADMIN'],
    ['PROFESIONAL', 'PSICOLOGO'],
    ['PSICOLOGO', 'PROFESIONAL'],
  ])('allows %s when metadata requires %s', (actual, required) => {
    const { guard, context } = setup(actual, [required]);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects SOPORTE when metadata requires ADMIN', () => {
    const { guard, context } = setup('SOPORTE', ['ADMIN']);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows SOPORTE when explicitly declared in metadata', () => {
    const { guard, context } = setup('SOPORTE', ['ADMIN', 'SOPORTE']);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a public route without a user', () => {
    const { guard, context } = setup(undefined, ['ADMIN'], true);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a route without role metadata', () => {
    const { guard, context } = setup(undefined);
    expect(guard.canActivate(context)).toBe(true);
  });
});
