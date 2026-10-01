import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FakturClient } from '../src/billing/faktur.client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { createTestTenant, TEST_PASSWORD } from './helpers/create-test-tenant';

jest.setTimeout(30000);

describe('Patient invoicing (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const faktur = { issueInvoice: jest.fn() };
  let tenantId: string;
  let otherTenantId: string;
  let token: string;
  let otherToken: string;

  const auth = (value: string) => ({ Authorization: `Bearer ${value}` });
  const server = () => app.getHttpServer();

  async function login(email: string): Promise<string> {
    const response = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return response.body.accessToken;
  }

  async function createPatient(body: Record<string, unknown>, tenant = tenantId, bearer = token) {
    const response = await request(server())
      .post(`/api/v1/tenants/${tenant}/patients`)
      .set(auth(bearer))
      .send({ firstName: 'Ana', lastName: 'Vega', email: 'ana@patient.test', ...body })
      .expect(201);
    return response.body as { id: string } & Record<string, unknown>;
  }

  const issue = (body: Record<string, unknown>, tenant = tenantId, bearer = token) =>
    request(server())
      .post(`/api/v1/tenants/${tenant}/billing/invoices`)
      .set(auth(bearer))
      .send({ subtotal: 100, tax: 15, description: 'Consulta', ...body });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FakturClient)
      .useValue(faktur)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.cleanDatabase();

    const tenantsService = app.get(TenantsService);
    tenantId = (await createTestTenant(tenantsService, 1)).id;
    otherTenantId = (await createTestTenant(tenantsService, 2)).id;
    // The clinic is the issuer and needs its own fiscal data to invoice.
    await prisma.tenant.updateMany({
      where: { id: { in: [tenantId, otherTenantId] } },
      data: { taxIdentificationType: 'RUC', taxIdentificationNumber: '1790000000001' },
    });
    token = await login('admin+1@tenant.test');
    otherToken = await login('admin+2@tenant.test');
  });

  beforeEach(() => {
    faktur.issueInvoice.mockReset();
    faktur.issueInvoice.mockResolvedValue({
      externalId: 'ext-1',
      pdfUrl: 'https://files.test/a.pdf',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues to the payer stored on the patient and lists it under that patient', async () => {
    const patient = await createPatient({
      billingName: 'Luis Vega',
      billingTaxIdType: 'CEDULA',
      billingTaxId: '171 234 5678',
      billingEmail: 'luis@payer.test',
    });
    expect(patient.billingTaxId).toBe('1712345678');

    const created = await issue({ patientId: patient.id, idempotencyKey: 'stored-1' }).expect(201);
    expect(created.body).toMatchObject({
      status: 'ISSUED',
      patientId: patient.id,
      customerName: 'Luis Vega',
      customerTaxIdType: 'CEDULA',
      customerTaxId: '1712345678',
      customerEmail: 'luis@payer.test',
    });
    expect(faktur.issueInvoice.mock.calls[0][0].customer).toMatchObject({
      legalName: 'Luis Vega',
      identificationNumber: '1712345678',
    });

    const list = await request(server())
      .get(`/api/v1/tenants/${tenantId}/billing/invoices`)
      .query({ patientId: patient.id })
      .set(auth(token))
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].patient).toEqual({ id: patient.id, firstName: 'Ana', lastName: 'Vega' });
  });

  it('issues to a third party and saves it on the patient when asked', async () => {
    const patient = await createPatient({ firstName: 'Niño', lastName: 'Mora', email: null });

    await issue({
      patientId: patient.id,
      idempotencyKey: 'third-1',
      customer: {
        name: 'Rosa Mora',
        taxIdType: 'CEDULA',
        taxId: '0912345678',
        email: 'rosa@payer.test',
        address: 'Calle 2',
      },
      saveCustomerToPatient: true,
    }).expect(201);

    const stored = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(stored).toMatchObject({
      billingName: 'Rosa Mora',
      billingTaxIdType: 'CEDULA',
      billingTaxId: '0912345678',
      billingEmail: 'rosa@payer.test',
      billingAddress: 'Calle 2',
    });
  });

  it('keeps an issued invoice unchanged when the patient billing data is edited later', async () => {
    const patient = await createPatient({
      billingName: 'Primer Pagador',
      billingTaxIdType: 'CEDULA',
      billingTaxId: '1712345678',
    });
    const created = await issue({ patientId: patient.id, idempotencyKey: 'snapshot-1' }).expect(
      201,
    );

    await request(server())
      .patch(`/api/v1/tenants/${tenantId}/patients/${patient.id}`)
      .set(auth(token))
      .send({ billingName: 'Segundo Pagador' })
      .expect(200);

    const invoice = await request(server())
      .get(`/api/v1/tenants/${tenantId}/billing/invoices/${created.body.id}`)
      .set(auth(token))
      .expect(200);
    expect(invoice.body.customerName).toBe('Primer Pagador');
  });

  it('rejects an incomplete payer without creating an invoice or calling the provider', async () => {
    const patient = await createPatient({ firstName: 'Sin', lastName: 'Datos' });
    const before = await prisma.invoice.count({ where: { tenantId } });

    const response = await issue({ patientId: patient.id }).expect(422);
    expect(response.body.code).toBe('INVOICE_CUSTOMER_INCOMPLETE');
    expect(response.body.details.fields).toEqual(['taxIdType', 'taxId']);
    expect(await prisma.invoice.count({ where: { tenantId } })).toBe(before);
    expect(faktur.issueInvoice).not.toHaveBeenCalled();
  });

  it('requires a patient and hides patients of another clinic or archived ones', async () => {
    await issue({}).expect(400);

    const foreign = await createPatient(
      { billingTaxIdType: 'CEDULA', billingTaxId: '1712345678' },
      otherTenantId,
      otherToken,
    );
    await issue({ patientId: foreign.id }).expect(404);

    const archived = await createPatient({
      billingTaxIdType: 'CEDULA',
      billingTaxId: '1712345678',
    });
    await request(server())
      .delete(`/api/v1/tenants/${tenantId}/patients/${archived.id}`)
      .set(auth(token))
      .expect(200);
    await issue({ patientId: archived.id }).expect(404);
    expect(faktur.issueInvoice).not.toHaveBeenCalled();
  });

  it('does not list another clinic invoices', async () => {
    const list = await request(server())
      .get(`/api/v1/tenants/${otherTenantId}/billing/invoices`)
      .set(auth(otherToken))
      .expect(200);
    expect(list.body).toEqual([]);
    await request(server())
      .get(`/api/v1/tenants/${tenantId}/billing/invoices`)
      .set(auth(otherToken))
      .expect(403);
  });

  it('rejects a billing type without a number on the patient', async () => {
    const response = await request(server())
      .post(`/api/v1/tenants/${tenantId}/patients`)
      .set(auth(token))
      .send({ firstName: 'Tipo', lastName: 'Solo', billingTaxIdType: 'RUC' })
      .expect(400);
    expect(response.body.code).toBe('PATIENT_BILLING_INVALID');
  });
});
