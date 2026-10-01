import { ForbiddenException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { PatientTeamController } from './patient-team.controller';
import { PatientTeamService } from './patient-team.service';
import { PatientTeamModule } from './patient-team.module';
import { ProfessionalEligibilityService } from './professional-eligibility.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RlsContextService } from '../prisma/rls-context.service';

describe('PatientTeamController HTTP contracts', () => {
  let app: INestApplication;
  const service = {
    list: jest.fn(),
    listEligible: jest.fn(),
    assign: jest.fn(),
    remove: jest.fn(),
  };
  const actor = {
    userId: 'actor',
    tenantId: 'tenant-1',
    role: 'PROFESIONAL',
    email: 'actor@example.test',
  };
  const base = '/tenants/tenant-1/patients/patient-1/team';
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PatientTeamController],
      providers: [{ provide: PatientTeamService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.user = actor;
      next();
    });
    app.useGlobalGuards(
      new TenantGuard(new Reflector(), new RlsContextService()),
      new RolesGuard(new Reflector()),
    );
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => jest.resetAllMocks());

  it('registers and exports the shared services with the controller', () => {
    expect(Reflect.getMetadata('controllers', PatientTeamModule)).toContain(PatientTeamController);
    expect(Reflect.getMetadata('providers', PatientTeamModule)).toEqual(
      expect.arrayContaining([PatientTeamService, ProfessionalEligibilityService]),
    );
    expect(Reflect.getMetadata('exports', PatientTeamModule)).toEqual(
      expect.arrayContaining([PatientTeamService, ProfessionalEligibilityService]),
    );
  });
  it('forwards GET with patient tenant and full actor', async () => {
    service.list.mockResolvedValue([{ id: 'assignment' }]);
    await request(app.getHttpServer())
      .get(base)
      .expect(200, [{ id: 'assignment' }]);
    expect(service.list).toHaveBeenCalledWith('tenant-1', 'patient-1', actor);
  });
  it.each([undefined, 'nutrition'])(
    'forwards eligible filter %s and full actor',
    async (specialtyId) => {
      service.listEligible.mockResolvedValue([]);
      await request(app.getHttpServer())
        .get(`${base}/eligible${specialtyId ? '?specialtyId=nutrition' : ''}`)
        .expect(200, []);
      expect(service.listEligible).toHaveBeenCalledWith(
        'tenant-1',
        'patient-1',
        specialtyId,
        actor,
      );
    },
  );
  it('forwards PUT without a body and preserves the safe service result', async () => {
    service.assign.mockResolvedValue({ id: 'assignment', isActive: true });
    await request(app.getHttpServer())
      .put(`${base}/target`)
      .expect(200, { id: 'assignment', isActive: true });
    expect(service.assign).toHaveBeenCalledWith('tenant-1', 'patient-1', 'target', actor);
  });
  it('lets DELETE reach the service for a professional and preserves its stable error', async () => {
    const response = {
      statusCode: 403,
      code: 'TEAM_ASSIGNMENT_FORBIDDEN',
      message: 'No tienes permiso para modificar este equipo tratante.',
    };
    service.remove.mockRejectedValue(new ForbiddenException(response));
    await request(app.getHttpServer()).delete(`${base}/target`).expect(403, response);
    expect(service.remove).toHaveBeenCalledWith('tenant-1', 'patient-1', 'target', actor);
  });
  it('rejects cross-tenant routes before entering the service', async () => {
    const response = await request(app.getHttpServer())
      .get('/tenants/tenant-2/patients/patient-1/team')
      .expect(403);
    expect(response.body.code).toBe('TENANT_SCOPE_VIOLATION');
    expect(service.list).not.toHaveBeenCalled();
  });
});
