import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TenantsService } from './../src/tenants/tenants.service';
import { createTestTenant, TEST_PASSWORD } from './helpers/create-test-tenant';

jest.setTimeout(30000);

describe('Tenant Isolation (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantsService: TenantsService;
  let tenant1Token: string;
  let tenant2Token: string;
  let tenant1Id: string;
  let tenant2Id: string;

  async function login(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);

    return response.body.accessToken;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
    tenantsService = app.get<TenantsService>(TenantsService);

    await prisma.cleanDatabase();

    const tenant1 = await createTestTenant(tenantsService, 1);
    const tenant2 = await createTestTenant(tenantsService, 2);

    tenant1Id = tenant1.id;
    tenant2Id = tenant2.id;
    tenant1Token = await login('admin+1@tenant.test');
    tenant2Token = await login('admin+2@tenant.test');
  });

  afterAll(async () => {
    await app.close();
  });

  it('should prevent tenant 1 from accessing tenant 2 resources', async () => {
    // Create patient in tenant 2
    const patient2 = await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenant2Id}/patients`)
      .set('Authorization', `Bearer ${tenant2Token}`)
      .send({
        firstName: 'Patient',
        lastName: 'Two',
        email: 'patient2@test.com',
      })
      .expect(201);

    // Try to access tenant 2's patient with tenant 1's token
    await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenant2Id}/patients/${patient2.body.id}`)
      .set('Authorization', `Bearer ${tenant1Token}`)
      .expect(403); // Forbidden - tenant mismatch
  });

  it('should allow tenant to access own resources', async () => {
    // Create patient in tenant 1
    const patient1 = await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenant1Id}/patients`)
      .set('Authorization', `Bearer ${tenant1Token}`)
      .send({
        firstName: 'Patient',
        lastName: 'One',
        email: 'patient1@test.com',
      })
      .expect(201);

    // Access own patient
    await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenant1Id}/patients/${patient1.body.id}`)
      .set('Authorization', `Bearer ${tenant1Token}`)
      .expect(200);
  });

  it('should prevent cross-tenant data leakage in list endpoints', async () => {
    const patient1 = await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenant1Id}/patients`)
      .set('Authorization', `Bearer ${tenant1Token}`)
      .send({
        firstName: 'Patient',
        lastName: 'T1',
        email: 'patient-t1@test.com',
      })
      .expect(201);

    const patient2 = await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenant2Id}/patients`)
      .set('Authorization', `Bearer ${tenant2Token}`)
      .send({
        firstName: 'Patient',
        lastName: 'T2',
        email: 'patient-t2@test.com',
      })
      .expect(201);

    const tenant1Patients = await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenant1Id}/patients`)
      .set('Authorization', `Bearer ${tenant1Token}`)
      .expect(200);

    const tenant1PatientIds = tenant1Patients.body.map((patient) => patient.id);

    expect(tenant1PatientIds).toContain(patient1.body.id);
    expect(tenant1PatientIds).not.toContain(patient2.body.id);
  });
});
