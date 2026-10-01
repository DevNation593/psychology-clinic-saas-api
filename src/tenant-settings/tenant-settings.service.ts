import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateTenantSettingsDto } from './dto/tenant-settings.dto';

@Injectable()
export class TenantSettingsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get tenant settings
   */
  async findOne(tenantId: string) {
    const settings = await this.prisma.tenantSettings.findUnique({
      where: { tenantId },
      include: {
        tenant: {
          select: {
            legalName: true,
            taxIdentificationType: true,
            taxIdentificationNumber: true,
            billingSettings: true,
          },
        },
      },
    });

    if (!settings) {
      throw new NotFoundException('Configuración del tenant no encontrada');
    }

    return {
      ...settings,
      legalName: settings.tenant.legalName,
      taxIdentificationType: settings.tenant.taxIdentificationType,
      taxIdentificationNumber: settings.tenant.taxIdentificationNumber,
      tenant: undefined,
      fakturApiKey: settings.tenant.billingSettings?.apiKey
        ? `********${settings.tenant.billingSettings.apiKey.slice(-4)}`
        : '',
      fakturApiUrl: settings.tenant.billingSettings?.apiUrl ?? '',
      fakturInvoicePath: settings.tenant.billingSettings?.invoicePath ?? '/invoices',
      fakturEnvironment: settings.tenant.billingSettings?.environment ?? 'TEST',
      fakturEstablishment: settings.tenant.billingSettings?.establishment ?? '',
      fakturEmissionPoint: settings.tenant.billingSettings?.emissionPoint ?? '',
      fakturNextSequential: settings.tenant.billingSettings?.nextSequential ?? 1,
      fakturBusinessName: settings.tenant.billingSettings?.businessName ?? '',
      fakturBusinessAddress: settings.tenant.billingSettings?.businessAddress ?? '',
      fakturSpecialTaxpayer: settings.tenant.billingSettings?.specialTaxpayer ?? false,
      fakturAccountingRequired: settings.tenant.billingSettings?.accountingRequired ?? false,
      fakturWithholdingAgent: settings.tenant.billingSettings?.withholdingAgent ?? false,
      fakturEnabled: settings.tenant.billingSettings?.isEnabled ?? false,
    };
  }

  /**
   * Update tenant settings
   */
  async update(tenantId: string, updateDto: UpdateTenantSettingsDto) {
    // Check settings exist
    const existing = await this.prisma.tenantSettings.findUnique({
      where: { tenantId },
    });

    if (!existing) {
      throw new NotFoundException('Configuración del tenant no encontrada');
    }

    // Validate working hours order if both provided
    const start = updateDto.workingHoursStart ?? existing.workingHoursStart;
    const end = updateDto.workingHoursEnd ?? existing.workingHoursEnd;

    if (start >= end) {
      throw new BadRequestException('La hora de fin debe ser posterior a la hora de inicio');
    }

    // Validate working days values
    const validDays = [
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
      'SUNDAY',
    ];
    if (updateDto.workingDays) {
      const invalidDays = updateDto.workingDays.filter((d) => !validDays.includes(d));
      if (invalidDays.length > 0) {
        throw new BadRequestException(
          `Días laborales inválidos: ${invalidDays.join(', ')}. Valores válidos: ${validDays.join(', ')}`,
        );
      }
    }

    const {
      legalName,
      taxIdentificationType,
      taxIdentificationNumber,
      fakturApiKey,
      fakturApiUrl,
      fakturInvoicePath,
      fakturEnvironment,
      fakturEstablishment,
      fakturEmissionPoint,
      fakturNextSequential,
      fakturBusinessName,
      fakturBusinessAddress,
      fakturSpecialTaxpayer,
      fakturAccountingRequired,
      fakturWithholdingAgent,
      fakturEnabled,
      ...settingsData
    } = updateDto;
    await this.prisma.$transaction(async (tx) => {
      await tx.tenantSettings.update({
        where: { tenantId },
        data: settingsData,
      });

      await tx.tenant.update({
        where: { id: tenantId },
        data: { legalName, taxIdentificationType, taxIdentificationNumber },
      });

      await tx.billingSettings.upsert({
        where: { tenantId },
        create: {
          tenantId,
          apiKey: fakturApiKey || null,
          apiUrl: fakturApiUrl,
          invoicePath: fakturInvoicePath ?? '/invoices',
          environment: fakturEnvironment ?? 'TEST',
          establishment: fakturEstablishment,
          emissionPoint: fakturEmissionPoint,
          nextSequential: fakturNextSequential ?? 1,
          businessName: fakturBusinessName,
          businessAddress: fakturBusinessAddress,
          specialTaxpayer: fakturSpecialTaxpayer ?? false,
          accountingRequired: fakturAccountingRequired ?? false,
          withholdingAgent: fakturWithholdingAgent ?? false,
          isEnabled: fakturEnabled ?? false,
        },
        update: {
          ...(fakturApiKey && !fakturApiKey.startsWith('********') ? { apiKey: fakturApiKey } : {}),
          apiUrl: fakturApiUrl,
          invoicePath: fakturInvoicePath,
          environment: fakturEnvironment,
          establishment: fakturEstablishment,
          emissionPoint: fakturEmissionPoint,
          nextSequential: fakturNextSequential,
          businessName: fakturBusinessName,
          businessAddress: fakturBusinessAddress,
          specialTaxpayer: fakturSpecialTaxpayer,
          accountingRequired: fakturAccountingRequired,
          withholdingAgent: fakturWithholdingAgent,
          isEnabled: fakturEnabled,
        },
      });
    });

    return this.findOne(tenantId);
  }
}
