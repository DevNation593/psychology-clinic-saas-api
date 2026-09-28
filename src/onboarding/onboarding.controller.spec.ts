import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { TenantsController } from '../tenants/tenants.controller';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

const valid = {
  clinicName: ' Clínica Centro ',
  contactEmail: ' CONTACT@EXAMPLE.COM ',
  timezone: 'America/Guayaquil',
  locale: 'es-EC',
  specialtyCodes: [' psychology '],
  adminFirstName: ' Ana ',
  adminLastName: ' Pérez ',
  adminEmail: ' ANA@EXAMPLE.COM ',
  adminPassword: 'Password123!',
  adminProvidesCare: false,
};

describe('OnboardingController HTTP contract', () => {
  let app: INestApplication;
  const service = {
    create: jest.fn(async (dto) => ({ tenant: { id: 'tenant-1' }, received: dto })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [OnboardingController],
      providers: [{ provide: OnboardingService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    service.create.mockClear();
  });

  it('accepts a valid non-clinical request at POST /onboarding/tenants', async () => {
    await request(app.getHttpServer()).post('/onboarding/tenants').send(valid).expect(201);
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.create.mock.calls[0][0]).toMatchObject({
      ...valid,
      clinicName: 'Clínica Centro',
      contactEmail: 'contact@example.com',
      specialtyCodes: ['PSYCHOLOGY'],
      adminFirstName: 'Ana',
      adminLastName: 'Pérez',
      adminEmail: 'ana@example.com',
    });
  });

  it('requires clinical specialty when the administrator provides care', async () => {
    await request(app.getHttpServer())
      .post('/onboarding/tenants')
      .send({ ...valid, adminProvidesCare: true })
      .expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('accepts a clinical administrator without optional title, license or bio', async () => {
    await request(app.getHttpServer())
      .post('/onboarding/tenants')
      .send({ ...valid, adminProvidesCare: true, adminSpecialtyCode: ' psychology ' })
      .expect(201);
    expect(service.create.mock.calls[0][0].adminSpecialtyCode).toBe('PSYCHOLOGY');
  });

  it('rejects contradictory clinical metadata when the administrator does not provide care', async () => {
    await request(app.getHttpServer())
      .post('/onboarding/tenants')
      .send({ ...valid, adminSpecialtyCode: 'PSYCHOLOGY' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/onboarding/tenants')
      .send({ ...valid, adminBio: 'Biography' })
      .expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('rejects empty selection, weak passwords and non-boolean care flag', async () => {
    await request(app.getHttpServer())
      .post('/onboarding/tenants')
      .send({ ...valid, specialtyCodes: [] })
      .expect(400);
    await request(app.getHttpServer())
      .post('/onboarding/tenants')
      .send({ ...valid, adminPassword: 'short' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/onboarding/tenants')
      .send({ ...valid, adminProvidesCare: 'false' })
      .expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('rejects tenant, role, price and flag fields supplied by the client', async () => {
    for (const forbidden of [
      { tenantId: 'other' },
      { role: 'SOPORTE' },
      { basePrice: 0 },
      { featureClinicalNotes: false },
    ]) {
      await request(app.getHttpServer())
        .post('/onboarding/tenants')
        .send({ ...valid, ...forbidden })
        .expect(400);
    }
    expect(service.create).not.toHaveBeenCalled();
  });

  it('marks only the onboarding handler public and leaves support creation protected', () => {
    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC_KEY, OnboardingController.prototype.create)).toBe(true);
    expect(reflector.get(IS_PUBLIC_KEY, TenantsController.prototype.create)).toBeUndefined();
    expect(reflector.get(IS_PUBLIC_KEY, TenantsController)).toBeUndefined();
  });
});
