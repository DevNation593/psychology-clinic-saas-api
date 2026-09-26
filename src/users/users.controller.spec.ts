import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RlsContextService } from '../prisma/rls-context.service';

describe('UsersController self profile route', () => {
  let app: INestApplication;
  const usersService = {
    updateSelf: jest.fn(),
    update: jest.fn(),
    createForTenant: jest.fn(),
    deactivate: jest.fn(),
    activate: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.user = {
        userId: req.header('x-test-user-id') || 'authenticated-professional',
        tenantId: req.header('x-test-tenant-id') || 'tenant-1',
        role: req.header('x-test-role') || 'PROFESIONAL',
      };
      next();
    });
    app.useGlobalGuards(
      new TenantGuard(new Reflector(), { set: jest.fn() } as unknown as RlsContextService),
      new RolesGuard(new Reflector()),
    );
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => jest.clearAllMocks());

  const member = {
    email: 'professional@example.com',
    password: 'Password123!',
    firstName: 'Ana',
    lastName: 'Vega',
    role: 'PROFESIONAL',
    professionalProfile: { specialtyId: 'specialty-1' },
  };

  it('creates a tenant member from the route and authenticated actor', async () => {
    usersService.createForTenant.mockResolvedValue({ id: 'created-user' });
    await request(app.getHttpServer())
      .post('/tenants/tenant-1/users')
      .set('x-test-role', 'ADMIN')
      .set('x-test-user-id', 'admin-1')
      .send(member)
      .expect(201);
    expect(usersService.createForTenant).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ email: member.email, password: member.password }),
      'admin-1',
    );
    expect(usersService.createForTenant.mock.calls[0][1]).not.toHaveProperty('tenantId');
  });

  it('rejects team creation by a non-admin or for another tenant', async () => {
    await request(app.getHttpServer())
      .post('/tenants/tenant-1/users')
      .set('x-test-role', 'PROFESIONAL')
      .send(member)
      .expect(403);
    await request(app.getHttpServer())
      .post('/tenants/other-tenant/users')
      .set('x-test-role', 'ADMIN')
      .send(member)
      .expect(403);
    expect(usersService.createForTenant).not.toHaveBeenCalled();
  });

  it.each(['tenantId', 'managedByProvider', 'emailVerified', 'activatedAt'])(
    'rejects forbidden create body field %s',
    async (field) => {
      await request(app.getHttpServer())
        .post('/tenants/tenant-1/users')
        .set('x-test-role', 'ADMIN')
        .send({ ...member, [field]: field === 'tenantId' ? 'tenant-1' : true })
        .expect(400);
      expect(usersService.createForTenant).not.toHaveBeenCalled();
    },
  );

  it('requires an initial password for direct creation', async () => {
    const { password: _password, ...withoutPassword } = member;
    await request(app.getHttpServer())
      .post('/tenants/tenant-1/users')
      .set('x-test-role', 'ADMIN')
      .send(withoutPassword)
      .expect(400);
    expect(usersService.createForTenant).not.toHaveBeenCalled();
  });

  it('passes the authenticated actor to admin edits and deactivation', async () => {
    usersService.update.mockResolvedValue({ id: 'member-1' });
    usersService.deactivate.mockResolvedValue({ message: 'ok' });
    await request(app.getHttpServer())
      .patch('/tenants/tenant-1/users/member-1')
      .set('x-test-role', 'ADMIN')
      .set('x-test-user-id', 'admin-1')
      .send({ firstName: 'Changed' })
      .expect(200);
    await request(app.getHttpServer())
      .delete('/tenants/tenant-1/users/member-1')
      .set('x-test-role', 'ADMIN')
      .set('x-test-user-id', 'admin-1')
      .expect(200);
    expect(usersService.update).toHaveBeenCalledWith(
      'tenant-1',
      'member-1',
      expect.objectContaining({ firstName: 'Changed' }),
      'admin-1',
    );
    expect(usersService.deactivate).toHaveBeenCalledWith('tenant-1', 'member-1', 'admin-1');
  });

  it.each(['ASISTENTE', 'PROFESIONAL'])('denies legacy account activation to %s', async (role) => {
    await request(app.getHttpServer())
      .post('/tenants/tenant-1/users/pending-1/activate')
      .set('x-test-role', role)
      .send({ password: 'Password123!' })
      .expect(403);
    expect(usersService.activate).not.toHaveBeenCalled();
  });

  it('lets the tenant admin attempt pending activation with actor identity', async () => {
    usersService.activate.mockResolvedValue({ id: 'pending-1', isActive: true });
    await request(app.getHttpServer())
      .post('/tenants/tenant-1/users/pending-1/activate')
      .set('x-test-role', 'ADMIN')
      .set('x-test-user-id', 'admin-1')
      .send({ password: 'Password123!' })
      .expect(201);
    expect(usersService.activate).toHaveBeenCalledWith(
      'tenant-1',
      'pending-1',
      'Password123!',
      'admin-1',
    );
  });

  it('denies pending activation across tenants', async () => {
    await request(app.getHttpServer())
      .post('/tenants/other-tenant/users/pending-1/activate')
      .set('x-test-role', 'ADMIN')
      .send({ password: 'Password123!' })
      .expect(403);
    expect(usersService.activate).not.toHaveBeenCalled();
  });

  it('lets a professional update only the authenticated account through /me', async () => {
    usersService.updateSelf.mockImplementation(async (tenantId, userId, dto) => ({
      tenantId,
      userId,
      ...dto,
    }));

    const response = await request(app.getHttpServer())
      .patch('/tenants/tenant-1/users/me')
      .set('x-test-user-id', 'authenticated-professional')
      .set('x-test-role', 'PROFESIONAL')
      .send({ firstName: 'María', phone: '+593 99 123 4567' })
      .expect(200);

    expect(response.body).toMatchObject({
      tenantId: 'tenant-1',
      userId: 'authenticated-professional',
      firstName: 'María',
    });
    expect(usersService.updateSelf).toHaveBeenCalledWith(
      'tenant-1',
      'authenticated-professional',
      expect.objectContaining({ firstName: 'María', phone: '+593 99 123 4567' }),
    );
    expect(usersService.update).not.toHaveBeenCalled();
  });

  it.each([
    'role',
    'email',
    'tenantId',
    'password',
    'specialtyId',
    'professionalTitle',
    'licenseNumber',
    'bio',
    'isActive',
    'seatLimit',
    'seatsPsychologistsMax',
    'seatsPsychologistsUsed',
    'specializations',
  ])('rejects unsupported self-update property %s', async (property) => {
    await request(app.getHttpServer())
      .patch('/tenants/tenant-1/users/me')
      .send({ [property]: property === 'specializations' ? [] : 'forbidden' })
      .expect(property === 'tenantId' ? 403 : 400);
    expect(usersService.updateSelf).not.toHaveBeenCalled();
  });

  it.each(['specialtyId', 'isActive', 'seatLimit', 'seatsPsychologistsUsed'])(
    'rejects unsupported professional profile property %s',
    async (property) => {
      await request(app.getHttpServer())
        .patch('/tenants/tenant-1/users/me')
        .send({ professionalProfile: { bio: 'Bio', [property]: 'forbidden' } })
        .expect(400);
      expect(usersService.updateSelf).not.toHaveBeenCalled();
    },
  );

  it('keeps the administrative user route unavailable to a professional', async () => {
    await request(app.getHttpServer())
      .patch('/tenants/tenant-1/users/another-user')
      .set('x-test-role', 'PROFESIONAL')
      .send({ firstName: 'Changed' })
      .expect(403);
    expect(usersService.update).not.toHaveBeenCalled();
  });
});
