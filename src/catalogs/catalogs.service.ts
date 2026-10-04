import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMedicationDto, UpdateMedicationDto } from './dto/medication.dto';

export const DIAGNOSIS_SYSTEMS = ['CIE10', 'CIE11'] as const;

const SEARCH_LIMIT = 20;
const MAX_MEDICATIONS_PER_TENANT = 5000;

const clean = (value?: string | null) => value?.trim() || null;

@Injectable()
export class CatalogsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Codes that start with the term come first, then descriptions that contain it. */
  async searchDiagnosisCodes(search: string, system?: string) {
    const term = search.trim();
    if (term.length < 2) return [];
    const scope = {
      isActive: true,
      ...((DIAGNOSIS_SYSTEMS as readonly string[]).includes(system ?? '') ? { system } : {}),
    };
    const select = { system: true, code: true, description: true } as const;

    const byCode = await this.prisma.diagnosisCode.findMany({
      where: { ...scope, code: { startsWith: term, mode: 'insensitive' } },
      select,
      orderBy: { code: 'asc' },
      take: SEARCH_LIMIT,
    });
    if (byCode.length >= SEARCH_LIMIT) return byCode;

    const byDescription = await this.prisma.diagnosisCode.findMany({
      where: {
        ...scope,
        description: { contains: term, mode: 'insensitive' },
        NOT: { code: { startsWith: term, mode: 'insensitive' } },
      },
      select,
      orderBy: { code: 'asc' },
      take: SEARCH_LIMIT - byCode.length,
    });
    return [...byCode, ...byDescription];
  }

  /** With a search term: the active medications that match, for prescribing. Without: all of them. */
  listMedications(tenantId: string, search?: string) {
    const term = search?.trim();
    return this.prisma.medication.findMany({
      where: {
        tenantId,
        ...(term
          ? {
              isActive: true,
              OR: [
                { commercialName: { contains: term, mode: 'insensitive' } },
                { activeIngredient: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { commercialName: 'asc' },
      ...(term ? { take: SEARCH_LIMIT } : {}),
    });
  }

  async createMedication(tenantId: string, dto: CreateMedicationDto) {
    const count = await this.prisma.medication.count({ where: { tenantId } });
    if (count >= MAX_MEDICATIONS_PER_TENANT) {
      throw new ConflictException({
        statusCode: 409,
        code: 'MEDICATION_LIMIT_REACHED',
        message: `El catálogo admite hasta ${MAX_MEDICATIONS_PER_TENANT} medicamentos.`,
      });
    }
    return this.prisma.medication.create({
      data: {
        tenantId,
        commercialName: dto.commercialName.trim(),
        activeIngredient: clean(dto.activeIngredient),
        concentration: clean(dto.concentration),
        presentation: clean(dto.presentation),
        pharmaceuticalForm: clean(dto.pharmaceuticalForm),
      },
    });
  }

  async updateMedication(tenantId: string, medicationId: string, dto: UpdateMedicationDto) {
    const medication = await this.prisma.medication.findFirst({
      where: { id: medicationId, tenantId },
      select: { id: true },
    });
    if (!medication) throw new NotFoundException('Medicamento no encontrado');

    return this.prisma.medication.update({
      where: { id: medicationId },
      data: {
        ...(typeof dto.commercialName === 'string'
          ? { commercialName: dto.commercialName.trim() }
          : {}),
        ...(dto.activeIngredient !== undefined
          ? { activeIngredient: clean(dto.activeIngredient) }
          : {}),
        ...(dto.concentration !== undefined ? { concentration: clean(dto.concentration) } : {}),
        ...(dto.presentation !== undefined ? { presentation: clean(dto.presentation) } : {}),
        ...(dto.pharmaceuticalForm !== undefined
          ? { pharmaceuticalForm: clean(dto.pharmaceuticalForm) }
          : {}),
        ...(typeof dto.isActive === 'boolean' ? { isActive: dto.isActive } : {}),
      },
    });
  }
}
