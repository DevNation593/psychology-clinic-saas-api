import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { FakturClient } from './faktur.client';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fakturClient: FakturClient,
  ) {}

  async createInvoice(tenantId: string, issuerId: string, dto: CreateInvoiceDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { subscription: true, billingSettings: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant no encontrado');
    }
    const issuer = await this.prisma.user.findFirst({
      where: {
        id: issuerId,
        tenantId,
        isActive: true,
        role: { in: ['CLIENTE', 'PSICOLOGO', 'ADMIN', 'PROFESIONAL'] },
      },
      select: { id: true },
    });
    if (!issuer) {
      throw new BadRequestException('El emisor no pertenece al tenant o no puede facturar');
    }
    if (!tenant.taxIdentificationType || !tenant.taxIdentificationNumber) {
      throw new BadRequestException('Completa los datos fiscales del tenant antes de facturar');
    }
    if (tenant.billingSettings && !tenant.billingSettings.isEnabled) {
      throw new BadRequestException(
        'La facturación electrónica está desactivada en la configuración',
      );
    }

    const periodStart = new Date();
    periodStart.setDate(1);
    periodStart.setHours(0, 0, 0, 0);
    const invoicesThisMonth = await this.prisma.invoice.count({
      where: {
        tenantId,
        status: InvoiceStatus.ISSUED,
        issueDate: { gte: periodStart },
      },
    });
    const invoiceLimit = tenant.subscription?.monthlyElectronicInvoicesLimit ?? 50;
    if (invoicesThisMonth >= invoiceLimit) {
      throw new BadRequestException(
        `Límite mensual de facturación alcanzado: ${invoiceLimit} facturas electrónicas.`,
      );
    }

    const tax = dto.tax ?? 0;
    const total = Number((dto.subtotal + tax).toFixed(2));
    const idempotencyKey =
      dto.idempotencyKey || `${tenantId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const existing = await this.prisma.invoice.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return existing;
    }

    const invoice = await this.prisma.invoice.create({
      data: {
        tenantId,
        subscriptionId: tenant.subscription?.id,
        issuerId,
        status: InvoiceStatus.PENDING,
        subtotal: new Prisma.Decimal(dto.subtotal),
        tax: new Prisma.Decimal(tax),
        total: new Prisma.Decimal(total),
        customerName: tenant.legalName || tenant.name,
        customerEmail: tenant.email,
        customerTaxIdType: tenant.taxIdentificationType,
        customerTaxId: tenant.taxIdentificationNumber,
        description: dto.description,
        idempotencyKey,
      },
    });

    try {
      const providerResponse = await this.fakturClient.issueInvoice(
        {
          idempotencyKey,
          customer: {
            legalName: invoice.customerName,
            email: invoice.customerEmail,
            identificationType: invoice.customerTaxIdType,
            identificationNumber: invoice.customerTaxId,
            address: tenant.address || undefined,
          },
          description: invoice.description,
          subtotal: Number(invoice.subtotal),
          tax: Number(invoice.tax),
          total: Number(invoice.total),
          currency: invoice.currency,
        },
        tenant.billingSettings?.apiKey
          ? {
              apiKey: tenant.billingSettings.apiKey,
              apiUrl: tenant.billingSettings.apiUrl || undefined,
              invoicePath: tenant.billingSettings.invoicePath,
              environment: tenant.billingSettings.environment,
              establishment: tenant.billingSettings.establishment || undefined,
              emissionPoint: tenant.billingSettings.emissionPoint || undefined,
              nextSequential: tenant.billingSettings.nextSequential,
            }
          : undefined,
      );

      const issuedInvoice = await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.ISSUED,
          externalId: this.readString(providerResponse, 'externalId', 'id'),
          accessKey: this.readString(providerResponse, 'accessKey', 'claveAcceso'),
          authorizationNumber: this.readString(
            providerResponse,
            'authorizationNumber',
            'numeroAutorizacion',
          ),
          xmlUrl: this.readString(providerResponse, 'xmlUrl', 'xml'),
          pdfUrl: this.readString(providerResponse, 'pdfUrl', 'pdf'),
          providerResponse: providerResponse as Prisma.InputJsonValue,
          errorMessage: null,
        },
      });
      await this.prisma.tenantSubscription.update({
        where: { tenantId },
        data: { monthlyElectronicInvoicesUsed: { increment: 1 } },
      });
      return issuedInvoice;
    } catch (error) {
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.FAILED,
          errorMessage:
            error instanceof Error ? error.message : 'Error desconocido al emitir en Faktur',
        },
      });
      throw error;
    }
  }

  listInvoices(tenantId: string) {
    return this.prisma.invoice.findMany({
      where: { tenantId },
      include: { issuer: { select: { id: true, firstName: true, lastName: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInvoice(tenantId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { issuer: { select: { id: true, firstName: true, lastName: true, role: true } } },
    });
    if (!invoice) {
      throw new NotFoundException('Comprobante no encontrado');
    }
    return invoice;
  }

  private readString(response: Record<string, unknown>, ...keys: string[]): string | undefined {
    for (const key of keys) {
      if (typeof response[key] === 'string') {
        return response[key] as string;
      }
    }
    return undefined;
  }
}
