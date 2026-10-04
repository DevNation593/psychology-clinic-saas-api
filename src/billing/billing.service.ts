import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { FakturClient, FakturInvoiceResponse } from './faktur.client';
import { resolveInvoiceCustomer } from './invoice-customer';

const invoiceInclude = {
  issuer: { select: { id: true, firstName: true, lastName: true, role: true } },
  patient: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.InvoiceInclude;

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
        // An assistant reaches this point only with the billing permission granted.
        role: { in: ['MASTER', 'PROFESIONAL', 'ASISTENTE'] },
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
    // Keys are namespaced per tenant so a client-supplied key can never resolve
    // to (or collide with) another tenant's invoice. Invoices created before the
    // namespace existed were stored under the raw key and must still match.
    const idempotencyKey = `${tenantId}:${dto.idempotencyKey || randomUUID()}`;
    const existing = await this.prisma.invoice.findFirst({
      where: {
        tenantId,
        idempotencyKey: {
          in: dto.idempotencyKey ? [idempotencyKey, dto.idempotencyKey] : [idempotencyKey],
        },
      },
    });
    if (existing) {
      // A key identifies one invoice. Answering a different request with it would tell the
      // caller that a patient was invoiced when they were not.
      if (existing.patientId !== dto.patientId || Number(existing.total) !== total) {
        throw new ConflictException({
          statusCode: 409,
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'Esta solicitud ya se usó para otra factura. Vuelve a intentarlo.',
        });
      }
      // Returned as stored: the caller must read `status`, a replay does not re-issue.
      return existing;
    }

    // Resolved only after the idempotency check, so a repeated request is answered
    // from the stored invoice without touching the patient again.
    const patient = await this.prisma.patient.findFirst({
      where: { id: dto.patientId, tenantId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        billingName: true,
        billingTaxIdType: true,
        billingTaxId: true,
        billingEmail: true,
        billingAddress: true,
      },
    });
    if (!patient) {
      throw new NotFoundException('Paciente no encontrado');
    }
    const resolved = resolveInvoiceCustomer(patient, dto.customer);
    if (!resolved.customer) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        code: 'INVOICE_CUSTOMER_INCOMPLETE',
        message: 'Completa los datos del receptor de la factura.',
        details: { fields: resolved.invalid },
      });
    }
    const customer = resolved.customer;

    const invoice = await this.prisma.$transaction(async (tx) => {
      await this.prisma.applyRlsContext(tx, { tenantId, userId: issuerId });
      if (dto.saveCustomerToPatient) {
        await tx.patient.update({
          where: { id: patient.id },
          data: {
            billingName: customer.name,
            billingTaxIdType: customer.taxIdType,
            billingTaxId: customer.taxId,
            billingEmail: customer.email,
            billingAddress: customer.address,
          },
        });
      }
      return tx.invoice.create({
        data: {
          tenantId,
          patientId: patient.id,
          issuerId,
          status: InvoiceStatus.PENDING,
          subtotal: new Prisma.Decimal(dto.subtotal),
          tax: new Prisma.Decimal(tax),
          total: new Prisma.Decimal(total),
          // Snapshot: later edits to the patient must not change an issued document.
          customerName: customer.name,
          customerEmail: customer.email,
          customerTaxIdType: customer.taxIdType,
          customerTaxId: customer.taxId,
          customerAddress: customer.address,
          description: dto.description,
          idempotencyKey,
        },
      });
    });

    const usesTenantConfiguration = !!tenant.billingSettings?.apiKey;
    let sequential: number | undefined;
    let providerResponse: FakturInvoiceResponse;

    try {
      if (usesTenantConfiguration) {
        // Reserve the sequential atomically so concurrent invoices never share one.
        const reserved = await this.prisma.billingSettings.update({
          where: { tenantId },
          data: { nextSequential: { increment: 1 } },
          select: { nextSequential: true },
        });
        sequential = reserved.nextSequential - 1;
      }

      providerResponse = await this.fakturClient.issueInvoice(
        {
          idempotencyKey,
          customer: {
            legalName: invoice.customerName,
            email: invoice.customerEmail,
            identificationType: invoice.customerTaxIdType,
            identificationNumber: invoice.customerTaxId,
            address: invoice.customerAddress || undefined,
          },
          description: invoice.description,
          subtotal: Number(invoice.subtotal),
          tax: Number(invoice.tax),
          total: Number(invoice.total),
          currency: invoice.currency,
        },
        usesTenantConfiguration
          ? {
              apiKey: tenant.billingSettings.apiKey,
              apiUrl: tenant.billingSettings.apiUrl || undefined,
              invoicePath: tenant.billingSettings.invoicePath,
              environment: tenant.billingSettings.environment,
              establishment: tenant.billingSettings.establishment || undefined,
              emissionPoint: tenant.billingSettings.emissionPoint || undefined,
              nextSequential: sequential,
            }
          : undefined,
      );
    } catch (error) {
      if (sequential !== undefined) {
        // Hand the unused sequential back, unless a later invoice already took the next one.
        await this.prisma.billingSettings
          .updateMany({
            where: { tenantId, nextSequential: sequential + 1 },
            data: { nextSequential: sequential },
          })
          .catch(() => undefined);
      }
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

    // From here on the document exists at the provider: bookkeeping failures
    // must not mark it as failed.
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
  }

  listInvoices(tenantId: string, filters: { patientId?: string } = {}) {
    const patientId = filters.patientId?.trim();
    return this.prisma.invoice.findMany({
      where: { tenantId, ...(patientId && { patientId }) },
      include: invoiceInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInvoice(tenantId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: invoiceInclude,
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
