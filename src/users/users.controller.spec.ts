import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { RolesGuard } from '../common/guards/roles.guard';

describe('UsersController self profile route', () => {
  let app: INestApplication;
  const usersService = {
    updateSelf: jest.fn(),
    update: jest.fn(),
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
    app.useGlobalGuards(new RolesGuard(new Reflector()));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => jest.clearAllMocks());

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
      .expect(400);
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
