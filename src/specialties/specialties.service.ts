import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantSpecialtiesService } from './tenant-specialties.service';

@Injectable()
export class SpecialtiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantSpecialties: TenantSpecialtiesService,
  ) {}

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

  async updateModule(tenantId: string, moduleKey: string, enabled: boolean, userId: string) {
    return this.tenantSpecialties.updateModule(tenantId, moduleKey, enabled, userId);
  }

  async setForTenant(tenantId: string, specialtyCodes: string[], userId: string) {
    return this.tenantSpecialties.replace(tenantId, specialtyCodes, userId);
  }
}
