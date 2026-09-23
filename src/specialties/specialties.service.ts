import { Injectable, NotFoundException } from '@nestjs/common';
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
}
