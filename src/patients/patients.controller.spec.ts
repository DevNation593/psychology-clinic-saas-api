import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RlsContextService } from '../prisma/rls-context.service';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

describe('PatientsController legacy assignment compatibility', () => {
  let app: INestApplication;
  const service = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  };
  const base = '/tenants/tenant-1/patients';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PatientsController],
      providers: [{ provide: PatientsService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.user = {
        userId: req.header('x-test-user-id') || 'actor-1',
        tenantId: 'tenant-1',
        role: req.header('x-test-role') || 'ADMIN',
        email: 'actor@example.test',
      };
      next();
    });
    app.useGlobalGuards(
      new TenantGuard(new Reflector(), new RlsContextService()),
      new RolesGuard(new Reflector()),
    );
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => app.close());
  beforeEach(() => jest.resetAllMocks());

  it('declares canonical write roles and keeps delete admin-only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PatientsController.prototype.create)).toEqual([
      'ADMIN',
      'ASISTENTE',
      'PROFESIONAL',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, PatientsController.prototype.update)).toEqual([
      'ADMIN',
      'ASISTENTE',
      'PROFESIONAL',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, PatientsController.prototype.remove)).toEqual(['ADMIN']);
  });

  it.each(['ADMIN', 'ASISTENTE', 'PROFESIONAL'])(
    'forwards POST with the %s actor and legacy pointer',
    async (role) => {
      service.create.mockResolvedValue({
        id: 'patient-1',
        assignedPsychologistId: 'professional-2',
      });
      await request(app.getHttpServer())
        .post(base)
        .set('x-test-role', role)
        .set('x-test-user-id', 'actor-2')
        .send({
          firstName: 'Ana',
          lastName: 'Paz',
          assignedPsychologistId: 'professional-2',
        })
        .expect(201);
      expect(service.create).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ assignedPsychologistId: 'professional-2' }),
        'actor-2',
        role,
      );
    },
  );

  it.each(['ADMIN', 'ASISTENTE', 'PROFESIONAL'])(
    'forwards PATCH with the %s actor and explicit null pointer',
    async (role) => {
      service.update.mockResolvedValue({ id: 'patient-1', assignedPsychologistId: null });
      await request(app.getHttpServer())
        .patch(`${base}/patient-1`)
        .set('x-test-role', role)
        .set('x-test-user-id', 'actor-2')
        .send({ assignedPsychologistId: null })
        .expect(200);
      expect(service.update).toHaveBeenCalledWith(
        'tenant-1',
        'patient-1',
        expect.objectContaining({ assignedPsychologistId: null }),
        'actor-2',
        role,
      );
    },
  );

  it('allows admin deletion and denies assistant deletion', async () => {
    service.softDelete.mockResolvedValue({ success: true });
    await request(app.getHttpServer())
      .delete(`${base}/patient-1`)
      .set('x-test-role', 'ADMIN')
      .expect(200);
    expect(service.softDelete).toHaveBeenCalledWith('tenant-1', 'patient-1', 'actor-1', 'ADMIN');
    await request(app.getHttpServer())
      .delete(`${base}/patient-1`)
      .set('x-test-role', 'ASISTENTE')
      .expect(403);
    expect(service.softDelete).toHaveBeenCalledTimes(1);
  });
});
