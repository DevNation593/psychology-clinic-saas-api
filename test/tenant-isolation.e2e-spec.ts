import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Tenant Isolation (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant1Token: string;
  let tenant2Token: string;
  let tenant1Id: string;
  let tenant2Id: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    // Clean database
    await prisma.cleanDatabase();

    // Create tenant 1
    const tenant1Response = await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .send({
        name: 'Tenant 1 Clinic',
        slug: 'tenant1',
        email: 'contact@tenant1.com',
        adminFirstName: 'Admin',
        adminLastName: 'One',
        adminEmail: 'admin@tenant1.com',
        adminPassword: 'password123',
      })
      .expect(201);

    tenant1Id = tenant1Response.body.id;

    // Create tenant 2
    const tenant2Response = await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .send({
        name: 'Tenant 2 Clinic',
        slug: 'tenant2',
        email: 'contact@tenant2.com',
        adminFirstName: 'Admin',
        adminLastName: 'Two',
        adminEmail: 'admin@tenant2.com',
        adminPassword: 'password123',
      })
      .expect(201);

    tenant2Id = tenant2Response.body.id;

    // Login tenant 1 admin
    const login1 = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@tenant1.com',
        password: 'password123',
      })
      .expect(200);

    tenant1Token = login1.body.accessToken;

    // Login tenant 2 admin
    const login2 = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@tenant2.com',
        password: 'password123',
      })
      .expect(200);

    tenant2Token = login2.body.accessToken;
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
    // Create patient in tenant 1
    await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenant1Id}/patients`)
      .set('Authorization', `Bearer ${tenant1Token}`)
      .send({
        firstName: 'Patient',
        lastName: 'T1',
        email: 'patient-t1@test.com',
      })
      .expect(201);

    // List patients as tenant 1
    const tenant1Patients = await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenant1Id}/patients`)
      .set('Authorization', `Bearer ${tenant1Token}`)
      .expect(200);

    // Should only see tenant 1 patients
    expect(tenant1Patients.body.every((p) => p.email.includes('t1') || p.email.includes('one'))).toBe(true);
  });
});
