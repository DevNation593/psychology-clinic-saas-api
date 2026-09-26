import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TenantSubscription } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { runSerializableTransaction } from '../prisma/serializable-transaction';
import {
  calculateSubscriptionPrice,
  getSelectedModules,
} from '../subscription/subscription-pricing';
import { SpecialtyCatalogService } from './specialty-catalog.service';

type CatalogSpecialty = Awaited<ReturnType<SpecialtyCatalogService['resolveActiveCodes']>>[number];

export type SpecialtySelectionResult = {
  tenantId: string;
  specialties: CatalogSpecialty[];
  modules: Array<{ moduleKey: string; enabled: boolean }>;
  pricing: ReturnType<typeof calculateSubscriptionPrice> & { currency: string };
};

@Injectable()
export class TenantSpecialtiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: SpecialtyCatalogService,
  ) {}

  async replace(
    tenantId: string,
    specialtyCodes: string[],
    actorId: string,
  ): Promise<SpecialtySelectionResult> {
    return runSerializableTransaction(this.prisma, tenantId, actorId, async (tx) => {
      const specialties = await this.catalog.resolveActiveCodes(specialtyCodes, tx);
      const subscription = await tx.tenantSubscription.findUnique({ where: { tenantId } });
      if (!subscription) throw new NotFoundException('Suscripción no encontrada');
      return this.applySelection(tx, { tenantId, subscription, specialties });
    });
  }

  async applySelection(
    tx: Prisma.TransactionClient,
    input: { tenantId: string; subscription: TenantSubscription; specialties: CatalogSpecialty[] },
  ): Promise<SpecialtySelectionResult> {
    const { tenantId, subscription, specialties } = input;
    if (specialties.length === 0) {
      throw new BadRequestException({
        code: 'SPECIALTY_SELECTION_REQUIRED',
        message: 'Selecciona al menos una especialidad.',
      });
    }
    const selectedIds = specialties.map(({ id }) => id);
    const [existingSelection, existingBilling, existingModules] = await Promise.all([
      tx.tenantSpecialty.findMany({ where: { tenantId }, select: { specialtyId: true } }),
      tx.subscriptionSpecialty.findMany({
        where: { tenantSubscriptionId: subscription.id },
        select: { specialtyId: true },
      }),
      tx.tenantModule.findMany({ where: { tenantId }, select: { moduleKey: true, enabled: true } }),
    ]);
    const oldIds = existingSelection.map(({ specialtyId }) => specialtyId);
    const removeIds = oldIds.filter((id) => !selectedIds.includes(id));
    for (const specialtyId of removeIds) {
      const activeProfessional = await tx.professionalProfile.findFirst({
        where: { specialtyId, isActive: true, user: { tenantId, isActive: true } },
        select: { userId: true },
      });
      if (activeProfessional) {
        throw new ConflictException({
          code: 'SPECIALTY_IN_USE_BY_ACTIVE_PROFESSIONAL',
          message: 'La especialidad tiene profesionales activos.',
        });
      }
      const futureAppointment = await tx.appointment.findFirst({
        where: {
          tenantId,
          specialtyId,
          startTime: { gt: new Date() },
          status: { not: 'CANCELLED' },
        },
        select: { id: true },
      });
      if (futureAppointment) {
        throw new ConflictException({
          code: 'SPECIALTY_HAS_FUTURE_APPOINTMENTS',
          message: 'La especialidad tiene citas futuras.',
        });
      }
    }

    const addIds = selectedIds.filter((id) => !oldIds.includes(id));
    if (removeIds.length)
      await tx.tenantSpecialty.deleteMany({ where: { tenantId, specialtyId: { in: removeIds } } });
    if (addIds.length)
      await tx.tenantSpecialty.createMany({
        data: addIds.map((specialtyId) => ({ tenantId, specialtyId })),
      });

    const billedIds = existingBilling.map(({ specialtyId }) => specialtyId);
    const removeBilled = billedIds.filter((id) => !selectedIds.includes(id));
    const addBilled = selectedIds.filter((id) => !billedIds.includes(id));
    if (removeBilled.length)
      await tx.subscriptionSpecialty.deleteMany({
        where: { tenantSubscriptionId: subscription.id, specialtyId: { in: removeBilled } },
      });
    if (addBilled.length)
      await tx.subscriptionSpecialty.createMany({
        data: addBilled.map((specialtyId) => ({
          tenantSubscriptionId: subscription.id,
          specialtyId,
        })),
      });

    const desiredKeys = [
      ...new Set(specialties.flatMap(({ modules }) => modules.map(({ moduleKey }) => moduleKey))),
    ].sort();
    const existingKeys = existingModules.map(({ moduleKey }) => moduleKey);
    const obsoleteCandidates = existingKeys.filter((key) => !desiredKeys.includes(key));
    const catalogOwners = obsoleteCandidates.length
      ? await tx.specialtyModule.findMany({
          where: { moduleKey: { in: obsoleteCandidates } },
          select: { moduleKey: true },
        })
      : [];
    const ownedKeys = new Set(catalogOwners.map(({ moduleKey }) => moduleKey));
    const removeKeys = obsoleteCandidates.filter((key) => ownedKeys.has(key));
    const addKeys = desiredKeys.filter((key) => !existingKeys.includes(key));
    if (removeKeys.length)
      await tx.tenantModule.deleteMany({ where: { tenantId, moduleKey: { in: removeKeys } } });
    if (addKeys.length)
      await tx.tenantModule.createMany({
        data: addKeys.map((moduleKey) => ({ tenantId, moduleKey, enabled: true })),
      });

    const pricing = calculateSubscriptionPrice({
      planType: subscription.planType,
      selectedModules: getSelectedModules(subscription),
      specialtyCount: specialties.length,
      specialtyUnitPrice: Number(subscription.specialtyPrice),
    });
    await tx.tenantSubscription.update({
      where: { tenantId },
      data: { basePrice: new Decimal(pricing.totalMonthly) },
    });
    return {
      tenantId,
      specialties,
      modules: [
        ...existingModules.filter(({ moduleKey }) => !removeKeys.includes(moduleKey)),
        ...addKeys.map((moduleKey) => ({ moduleKey, enabled: true })),
      ].sort((a, b) => a.moduleKey.localeCompare(b.moduleKey)),
      pricing: { ...pricing, currency: subscription.currency },
    };
  }

  async updateModule(tenantId: string, moduleKey: string, enabled: boolean, actorId: string) {
    return runSerializableTransaction(this.prisma, tenantId, actorId, async (tx) => {
      const owner = await tx.tenantSpecialty.findFirst({
        where: { tenantId, specialty: { isActive: true, modules: { some: { moduleKey } } } },
        select: { specialtyId: true },
      });
      if (!owner)
        throw new ConflictException({
          code: 'MODULE_SPECIALTY_NOT_ENABLED',
          message: 'El módulo requiere una especialidad habilitada.',
        });
      const module = await tx.tenantModule.findUnique({
        where: { tenantId_moduleKey: { tenantId, moduleKey } },
      });
      if (!module) {
        if (!enabled)
          throw new NotFoundException('El módulo no está configurado para este consultorio');
        return tx.tenantModule.create({ data: { tenantId, moduleKey, enabled: true } });
      }
      return tx.tenantModule.update({ where: { id: module.id }, data: { enabled } });
    });
  }
}
