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
    invoice: { count: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    tenantSubscription: { update: jest.fn() },
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
});
