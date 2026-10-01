import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantGuard } from './tenant.guard';
import { RlsContextService } from '../../prisma/rls-context.service';

describe('TenantGuard scope errors', () => {
  const rls = new RlsContextService();
  const guard = new TenantGuard(new Reflector(), rls);
  const user = { tenantId: 'tenant-1', userId: 'actor', role: 'ADMIN' };
  const context = (request: unknown) =>
    ({
      getHandler: () => () => undefined,
      getClass: () => TenantGuard,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  it.each([
    [{ params: { tenantId: 'tenant-2' } }, 'Acceso denegado: El tenant no coincide'],
    [
      { body: { tenantId: 'tenant-2' } },
      'Acceso denegado: No puede crear recursos para otro tenant',
    ],
  ])('returns stable scope errors without setting RLS for %j', (input, message) => {
    rls.run({}, () => {
      let caught: unknown;
      try {
        guard.canActivate(context({ ...input, user }));
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        status: 403,
        response: { statusCode: 403, code: 'TENANT_SCOPE_VIOLATION', message },
      });
      expect(rls.get()).toEqual({});
    });
  });

  it('initializes the matching request tenant and RLS context', () => {
    const request = {
      user,
      params: { tenantId: 'tenant-1' },
      body: { tenantId: 'tenant-1' },
      tenantId: undefined,
    };
    rls.run({}, () => {
      expect(guard.canActivate(context(request))).toBe(true);
      expect(request.tenantId).toBe('tenant-1');
      expect(rls.get()).toEqual(user);
    });
  });
});
