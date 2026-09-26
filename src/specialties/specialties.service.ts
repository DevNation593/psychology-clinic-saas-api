import { Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { runSerializableTransaction } from '../prisma/serializable-transaction';
import {
  calculateSubscriptionPrice,
  getSelectedModules,
} from '../subscription/subscription-pricing';

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
    const specialties = await this.prisma.specialty.findMany({
      where: { code: { in: codes }, isActive: true },
      include: { modules: true },
    });
    if (specialties.length !== codes.length) {
      throw new NotFoundException('Una o más especialidades no existen o están inactivas');
    }

    const selectedIds = specialties.map((specialty) => specialty.id);
    const specialtyModules = specialties.flatMap((specialty) =>
      specialty.modules.map((module) => module.moduleKey),
    );
    return runSerializableTransaction(this.prisma, tenantId, userId, async (tx) => {
      const subscription = await tx.tenantSubscription.findUnique({ where: { tenantId } });
      if (!subscription) throw new NotFoundException('Suscripción no encontrada');
      const pricing = calculateSubscriptionPrice({
        planType: subscription.planType,
        selectedModules: getSelectedModules(subscription),
        specialtyCount: selectedIds.length,
        specialtyUnitPrice: Number(subscription.specialtyPrice),
      });

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
          basePrice: new Decimal(pricing.totalMonthly),
        },
      });
      return { tenantId, specialties: specialties.map(({ code, name }) => ({ code, name })) };
    });
  }
}
