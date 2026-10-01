import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FakturClient } from './faktur.client';
import { BillingService } from './billing.service';

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
    invoice: { count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    tenantSubscription: { update: jest.fn() },
    billingSettings: { update: jest.fn(), updateMany: jest.fn() },
  };
  const faktur = { issueInvoice: jest.fn() };
  let service: BillingService;

  beforeEach(() => {
    jest.resetAllMocks();
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
      service.createInvoice('tenant-1', 'issuer-1', { subtotal: 20, description: 'Consulta' }),
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
      service.createInvoice('tenant-1', 'issuer-1', { subtotal: 20, description: 'Consulta' }),
    ).rejects.toThrow(BadRequestException);
  });

  describe('issuing', () => {
    const dto = { subtotal: 20, description: 'Consulta', idempotencyKey: 'period-2026-09' };

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
  });
});
