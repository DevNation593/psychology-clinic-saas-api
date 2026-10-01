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
    ['MASTER', ['MASTER']],
    ['PROFESIONAL', ['MASTER', 'PROFESIONAL']],
    ['ASISTENTE', ['MASTER', 'ASISTENTE', 'PROFESIONAL']],
  ])('allows %s when metadata requires %j', (actual, required) => {
    const { guard, context } = setup(actual, required);
    expect(guard.canActivate(context)).toBe(true);
  });

  it.each(['PROFESIONAL', 'ASISTENTE', 'ADMIN', 'CLIENTE', 'PSICOLOGO', 'SOPORTE', 'PACIENTE'])(
    'rejects %s when metadata requires MASTER',
    (actual) => {
      const { guard, context } = setup(actual, ['MASTER']);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    },
  );

  it.each(['ADMIN', 'CLIENTE', 'PSICOLOGO'])(
    'rejects %s on clinical endpoints open to the whole clinic team',
    (actual) => {
      const { guard, context } = setup(actual, ['MASTER', 'ASISTENTE', 'PROFESIONAL']);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    },
  );

  it('allows SOPORTE when explicitly declared in metadata', () => {
    const { guard, context } = setup('SOPORTE', ['MASTER', 'SOPORTE']);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a public route without a user', () => {
    const { guard, context } = setup(undefined, ['MASTER'], true);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a route without role metadata', () => {
    const { guard, context } = setup(undefined);
    expect(guard.canActivate(context)).toBe(true);
  });
});
