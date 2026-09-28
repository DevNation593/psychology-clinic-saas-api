import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type CatalogClient = PrismaService | Prisma.TransactionClient;

type CatalogRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  modules: { id: string; moduleKey: string }[];
};

function toCatalogSpecialty(row: CatalogRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    modules: row.modules.map(({ id, moduleKey }) => ({ id, moduleKey })),
  };
}

export function normalizeSpecialtyCodes(codes: readonly string[]): string[] {
  return [...new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean))];
}

@Injectable()
export class SpecialtyCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(client: CatalogClient = this.prisma) {
    const rows = await client.specialty.findMany({
      where: { isActive: true },
      include: { modules: { orderBy: { moduleKey: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    return rows.map(toCatalogSpecialty);
  }

  async resolveActiveCodes(codes: readonly string[], client: CatalogClient = this.prisma) {
    const normalized = normalizeSpecialtyCodes(codes);
    if (normalized.length === 0) {
      throw new BadRequestException({
        code: 'SPECIALTY_SELECTION_REQUIRED',
        message: 'Selecciona al menos una especialidad.',
      });
    }

    const rows = await client.specialty.findMany({
      where: { code: { in: normalized }, isActive: true },
      include: { modules: { orderBy: { moduleKey: 'asc' } } },
    });
    const byCode = new Map(rows.map((row) => [row.code, row]));
    const missing = normalized.find((code) => !byCode.has(code));
    if (missing) {
      throw new NotFoundException({
        code: 'SPECIALTY_NOT_AVAILABLE',
        message: `La especialidad ${missing} no existe o está inactiva.`,
      });
    }
    return normalized.map((code) => toCatalogSpecialty(byCode.get(code)!));
  }
}
