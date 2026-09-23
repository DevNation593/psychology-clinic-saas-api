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

  async createInvoice(tenantId: string, dto: CreateInvoiceDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { subscription: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant no encontrado');
    }
    if (!tenant.taxIdentificationType || !tenant.taxIdentificationNumber) {
      throw new BadRequestException('Completa los datos fiscales del tenant antes de facturar');
    }

    const tax = dto.tax ?? 0;
    const total = Number((dto.subtotal + tax).toFixed(2));
    const idempotencyKey = dto.idempotencyKey || `${tenantId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const existing = await this.prisma.invoice.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return existing;
    }

    const invoice = await this.prisma.invoice.create({
      data: {
        tenantId,
        subscriptionId: tenant.subscription?.id,
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
      const providerResponse = await this.fakturClient.issueInvoice({
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
      });

      return await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.ISSUED,
          externalId: this.readString(providerResponse, 'externalId', 'id'),
          accessKey: this.readString(providerResponse, 'accessKey', 'claveAcceso'),
          authorizationNumber: this.readString(providerResponse, 'authorizationNumber', 'numeroAutorizacion'),
          xmlUrl: this.readString(providerResponse, 'xmlUrl', 'xml'),
          pdfUrl: this.readString(providerResponse, 'pdfUrl', 'pdf'),
          providerResponse: providerResponse as Prisma.InputJsonValue,
          errorMessage: null,
        },
      });
    } catch (error) {
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.FAILED,
          errorMessage: error instanceof Error ? error.message : 'Error desconocido al emitir en Faktur',
        },
      });
      throw error;
    }
  }

  listInvoices(tenantId: string) {
    return this.prisma.invoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInvoice(tenantId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
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
