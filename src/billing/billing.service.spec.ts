import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FakturClient } from './faktur.client';
import { BillingService } from './billing.service';

const patientRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'patient-1',
  firstName: 'Ana',
  lastName: 'Vega',
  email: 'ana@example.com',
  billingName: 'Luis Vega',
  billingTaxIdType: 'CEDULA',
  billingTaxId: '1712345678',
  billingEmail: 'luis@example.com',
  billingAddress: 'Av. 1',
  ...overrides,
});

describe('BillingService invoice issuer role compatibility', () => {
  const tenant = {
    id: 'tenant-1',
    subscription: null,
    billingSettings: null,
    taxIdentificationType: null,
    taxIdentificationNumber: null,
  };
  const prisma = {
    tenant: { findUnique: jest.fn() },
    user: { findFirst: jest.fn() },
    patient: { findFirst: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
    invoice: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    tenantSubscription: { update: jest.fn() },
    billingSettings: { update: jest.fn(), updateMany: jest.fn() },
  };
  const faktur = { issueInvoice: jest.fn() };
  let service: BillingService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback(prisma),
    );
    prisma.patient.findFirst.mockResolvedValue(patientRow());
    prisma.tenant.findUnique.mockResolvedValue(tenant);
    prisma.user.findFirst.mockImplementation(async ({ where }) => {
      const issuer = {
        id: 'issuer-1',
        tenantId: 'tenant-1',
        role: 'ADMIN',
        isActive: true,
      };
      const allowedRoles: string[] = where.role?.in ?? [where.role];
      return issuer.id === where.id &&
        issuer.tenantId === where.tenantId &&
        issuer.isActive === where.isActive &&
        allowedRoles.includes(issuer.role)
        ? { id: issuer.id }
        : null;
    });
    service = new BillingService(
      prisma as unknown as PrismaService,
      faktur as unknown as FakturClient,
    );
  });

  it('accepts a canonical ADMIN issuer while retaining tenant and active checks', async () => {
    await expect(
      service.createInvoice('tenant-1', 'issuer-1', {
        patientId: 'patient-1',
        subtotal: 20,
        description: 'Consulta',
      }),
    ).rejects.toThrow('Completa los datos fiscales del tenant antes de facturar');

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'issuer-1',
        tenantId: 'tenant-1',
        isActive: true,
        role: { in: ['CLIENTE', 'PSICOLOGO', 'ADMIN', 'PROFESIONAL'] },
      },
      select: { id: true },
    });
  });

  it.each([
    ['a disallowed role', { role: 'ASISTENTE', tenantId: 'tenant-1', isActive: true }],
    ['another tenant', { role: 'ADMIN', tenantId: 'tenant-2', isActive: true }],
    ['an inactive issuer', { role: 'ADMIN', tenantId: 'tenant-1', isActive: false }],
  ])('rejects %s', async (_description, issuer) => {
    prisma.user.findFirst.mockImplementation(async ({ where }) => {
      const allowedRoles: string[] = where.role?.in ?? [where.role];
      return issuer.tenantId === where.tenantId &&
        issuer.isActive === where.isActive &&
        allowedRoles.includes(issuer.role)
        ? { id: where.id }
        : null;
    });

    await expect(
      service.createInvoice('tenant-1', 'issuer-1', {
        patientId: 'patient-1',
        subtotal: 20,
        description: 'Consulta',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  describe('issuing', () => {
    const dto = {
      patientId: 'patient-1',
      subtotal: 20,
      description: 'Consulta',
      idempotencyKey: 'period-2026-09',
    };

    beforeEach(() => {
      prisma.tenant.findUnique.mockResolvedValue({
        ...tenant,
        name: 'Clínica',
        email: 'clinic@example.com',
        taxIdentificationType: 'RUC',
        taxIdentificationNumber: '1790000000001',
        billingSettings: {
          isEnabled: true,
          apiKey: 'tenant-key',
          invoicePath: '/invoices',
          environment: 'TEST',
          nextSequential: 17,
        },
      });
      prisma.invoice.count.mockResolvedValue(0);
      prisma.invoice.findFirst.mockResolvedValue(null);
      prisma.invoice.create.mockImplementation(async ({ data }) => ({
        id: 'invoice-1',
        currency: 'USD',
        ...data,
      }));
      prisma.invoice.update.mockImplementation(async ({ data }) => ({ id: 'invoice-1', ...data }));
      prisma.billingSettings.update.mockResolvedValue({ nextSequential: 18 });
      prisma.billingSettings.updateMany.mockResolvedValue({ count: 1 });
      faktur.issueInvoice.mockResolvedValue({ externalId: 'ext-1' });
    });

    it('matches invoices stored under the namespaced or the legacy raw key', async () => {
      prisma.invoice.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(service.createInvoice('tenant-1', 'issuer-1', dto)).resolves.toEqual({
        id: 'existing',
      });
      expect(prisma.invoice.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          idempotencyKey: { in: ['tenant-1:period-2026-09', 'period-2026-09'] },
        },
      });
      expect(faktur.issueInvoice).not.toHaveBeenCalled();
    });

    it('reserves the sequential atomically before calling the provider', async () => {
      await service.createInvoice('tenant-1', 'issuer-1', dto);

      expect(prisma.billingSettings.update).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        data: { nextSequential: { increment: 1 } },
        select: { nextSequential: true },
      });
      expect(faktur.issueInvoice.mock.calls[0][1]).toMatchObject({ nextSequential: 17 });
      expect(prisma.billingSettings.updateMany).not.toHaveBeenCalled();
    });

    it('releases the sequential and marks the invoice failed when the provider rejects', async () => {
      faktur.issueInvoice.mockRejectedValue(new Error('rechazado'));

      await expect(service.createInvoice('tenant-1', 'issuer-1', dto)).rejects.toThrow('rechazado');

      expect(prisma.billingSettings.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', nextSequential: 18 },
        data: { nextSequential: 17 },
      });
      expect(prisma.invoice.update.mock.calls[0][0].data.status).toBe('FAILED');
    });

    it('keeps an issued invoice issued when usage bookkeeping fails', async () => {
      prisma.tenantSubscription.update.mockRejectedValue(new Error('db down'));

      await expect(service.createInvoice('tenant-1', 'issuer-1', dto)).rejects.toThrow('db down');

      expect(prisma.invoice.update).toHaveBeenCalledTimes(1);
      expect(prisma.invoice.update.mock.calls[0][0].data.status).toBe('ISSUED');
    });

    describe('to a patient', () => {
      it('issues to the payer stored on the patient and links the invoice', async () => {
        await service.createInvoice('tenant-1', 'issuer-1', dto);

        expect(prisma.patient.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'patient-1', tenantId: 'tenant-1', deletedAt: null },
          }),
        );
        expect(prisma.invoice.create.mock.calls[0][0].data).toMatchObject({
          patientId: 'patient-1',
          customerName: 'Luis Vega',
          customerEmail: 'luis@example.com',
          customerTaxIdType: 'CEDULA',
          customerTaxId: '1712345678',
          customerAddress: 'Av. 1',
        });
        expect(prisma.invoice.create.mock.calls[0][0].data).not.toHaveProperty('subscriptionId');
        expect(faktur.issueInvoice.mock.calls[0][0].customer).toEqual({
          legalName: 'Luis Vega',
          email: 'luis@example.com',
          identificationType: 'CEDULA',
          identificationNumber: '1712345678',
          address: 'Av. 1',
        });
      });

      it('issues to a third party given in the request without changing the patient', async () => {
        await service.createInvoice('tenant-1', 'issuer-1', {
          ...dto,
          customer: { name: 'Seguros Andina S.A.', taxIdType: 'RUC', taxId: '1790000000001' },
        });

        expect(prisma.invoice.create.mock.calls[0][0].data).toMatchObject({
          patientId: 'patient-1',
          customerName: 'Seguros Andina S.A.',
          customerTaxIdType: 'RUC',
          customerTaxId: '1790000000001',
          customerEmail: 'luis@example.com',
        });
        expect(prisma.patient.update).not.toHaveBeenCalled();
      });

      it('saves the resolved payer on the patient when asked', async () => {
        prisma.patient.findFirst.mockResolvedValue(
          patientRow({
            billingName: null,
            billingTaxIdType: null,
            billingTaxId: null,
            billingEmail: null,
            billingAddress: null,
          }),
        );
        await service.createInvoice('tenant-1', 'issuer-1', {
          ...dto,
          customer: { taxIdType: 'CEDULA', taxId: '171 234 5678' },
          saveCustomerToPatient: true,
        });

        expect(prisma.patient.update).toHaveBeenCalledWith({
          where: { id: 'patient-1' },
          data: {
            billingName: 'Ana Vega',
            billingTaxIdType: 'CEDULA',
            billingTaxId: '1712345678',
            billingEmail: 'ana@example.com',
            billingAddress: null,
          },
        });
      });

      it('keeps the saved payer when the provider then fails', async () => {
        faktur.issueInvoice.mockRejectedValue(new Error('Faktur no disponible'));
        await expect(
          service.createInvoice('tenant-1', 'issuer-1', { ...dto, saveCustomerToPatient: true }),
        ).rejects.toThrow('Faktur no disponible');

        expect(prisma.patient.update).toHaveBeenCalledTimes(1);
        expect(prisma.invoice.update.mock.calls[0][0].data).toMatchObject({ status: 'FAILED' });
      });

      it('answers 404 for a patient that is missing, archived or in another clinic', async () => {
        prisma.patient.findFirst.mockResolvedValue(null);
        await expect(service.createInvoice('tenant-1', 'issuer-1', dto)).rejects.toMatchObject({
          status: 404,
          message: 'Paciente no encontrado',
        });
        expect(prisma.invoice.create).not.toHaveBeenCalled();
        expect(faktur.issueInvoice).not.toHaveBeenCalled();
      });

      it('rejects an incomplete payer before creating the invoice or reserving a sequential', async () => {
        prisma.patient.findFirst.mockResolvedValue(
          patientRow({ billingTaxIdType: null, billingTaxId: null }),
        );
        await expect(service.createInvoice('tenant-1', 'issuer-1', dto)).rejects.toMatchObject({
          status: 422,
          response: {
            code: 'INVOICE_CUSTOMER_INCOMPLETE',
            details: { fields: ['taxIdType', 'taxId'] },
          },
        });
        expect(prisma.invoice.create).not.toHaveBeenCalled();
        expect(prisma.billingSettings.update).not.toHaveBeenCalled();
        expect(faktur.issueInvoice).not.toHaveBeenCalled();
      });

      it('returns an existing invoice for a repeated key without re-reading or saving the patient', async () => {
        prisma.invoice.findFirst.mockResolvedValue({ id: 'existing' });
        await expect(
          service.createInvoice('tenant-1', 'issuer-1', { ...dto, saveCustomerToPatient: true }),
        ).resolves.toEqual({ id: 'existing' });
        expect(prisma.patient.findFirst).not.toHaveBeenCalled();
        expect(prisma.patient.update).not.toHaveBeenCalled();
      });
    });
  });
});
