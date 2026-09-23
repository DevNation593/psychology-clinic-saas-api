import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SpecialtiesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForTenant(tenantId: string) {
    const specialties = await this.prisma.tenantSpecialty.findMany({
      where: { tenantId, specialty: { isActive: true } },
      include: {
        specialty: {
          include: { modules: true },
        },
      },
      orderBy: { specialty: { name: 'asc' } },
    });

    return specialties.map(({ specialty }) => specialty);
  }

  async listModulesForTenant(tenantId: string) {
    return this.prisma.tenantModule.findMany({
      where: { tenantId },
      orderBy: { moduleKey: 'asc' },
    });
  }

  async updateModule(tenantId: string, moduleKey: string, enabled: boolean) {
    const module = await this.prisma.tenantModule.findUnique({
      where: { tenantId_moduleKey: { tenantId, moduleKey } },
    });

    if (!module) {
      throw new NotFoundException('El módulo no está configurado para este consultorio');
    }

    return this.prisma.tenantModule.update({
      where: { id: module.id },
      data: { enabled },
    });
  }

  async setForTenant(tenantId: string, specialtyCodes: string[], userId: string) {
    const codes = [...new Set(specialtyCodes.map((code) => code.toUpperCase()))];
    const [subscription, specialties, currentSelection] = await Promise.all([
      this.prisma.tenantSubscription.findUnique({ where: { tenantId } }),
      this.prisma.specialty.findMany({
        where: { code: { in: codes }, isActive: true },
        include: { modules: true },
      }),
      this.prisma.tenantSpecialty.count({ where: { tenantId } }),
    ]);

    if (!subscription) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    if (specialties.length !== codes.length) {
      throw new NotFoundException('Una o más especialidades no existen o están inactivas');
    }
    const additionalSpecialties = Math.max(0, specialties.length - subscription.includedSpecialties);
    const currentAdditionalSpecialties = Math.max(0, currentSelection - subscription.includedSpecialties);

    const selectedIds = specialties.map((specialty) => specialty.id);
    const specialtyModules = specialties.flatMap((specialty) => specialty.modules.map((module) => module.moduleKey));
    return this.prisma.$transaction(async (tx) => {
      await tx.tenantSpecialty.deleteMany({
        where: { tenantId, specialtyId: { notIn: selectedIds } },
      });
      await tx.tenantSpecialty.createMany({
        data: selectedIds.map((specialtyId) => ({ tenantId, specialtyId })),
        skipDuplicates: true,
      });
      await tx.tenantModule.createMany({
        data: specialtyModules.map((moduleKey) => ({ tenantId, moduleKey, enabled: true })),
        skipDuplicates: true,
      });
      await tx.tenantModule.deleteMany({
        where: {
          tenantId,
          moduleKey: { contains: '.' },
          NOT: { moduleKey: { in: specialtyModules } },
        },
      });
      await tx.tenantSubscription.update({
        where: { tenantId },
        data: {
          basePrice: {
            increment: new Decimal(
              (additionalSpecialties - currentAdditionalSpecialties) * Number(subscription.specialtyPrice),
            ),
          },
        },
      });
      return { tenantId, specialties: specialties.map(({ code, name }) => ({ code, name })) };
    });
  }
}
