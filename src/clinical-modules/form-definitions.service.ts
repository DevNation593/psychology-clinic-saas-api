import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { validateFormSchema } from '../clinical-forms/form-schema';
import { CreateFormDefinitionDto, UpdateFormDefinitionDto } from './dto/form-definition.dto';

const MAX_FORMS_PER_TENANT = 200;

const definitionInclude = {
  specialty: { select: { id: true, code: true, name: true } },
  versions: { orderBy: { version: 'asc' } },
} satisfies Prisma.FormDefinitionInclude;

const isUniqueViolation = (error: unknown) =>
  (error as Prisma.PrismaClientKnownRequestError)?.code === 'P2002';

const nameTaken = () =>
  new ConflictException({
    statusCode: 409,
    code: 'FORM_NAME_TAKEN',
    message: 'Ya existe un formulario con ese nombre.',
  });

/** Key order is not meaningful in a schema, so two schemas are compared in canonical form. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

@Injectable()
export class FormDefinitionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.formDefinition.findMany({
      where: { tenantId },
      include: definitionInclude,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(tenantId: string, formId: string) {
    const form = await this.prisma.formDefinition.findFirst({
      where: { id: formId, tenantId },
      include: definitionInclude,
    });
    if (!form) throw new NotFoundException('Formulario no encontrado');
    return form;
  }

  async create(tenantId: string, userId: string, dto: CreateFormDefinitionDto) {
    const schema = validateFormSchema(dto.schema);

    try {
      return await this.transaction(async (tx) => {
        const count = await tx.formDefinition.count({ where: { tenantId } });
        if (count >= MAX_FORMS_PER_TENANT) {
          throw new ConflictException({
            statusCode: 409,
            code: 'FORM_LIMIT_REACHED',
            message: `Un consultorio puede tener hasta ${MAX_FORMS_PER_TENANT} formularios.`,
          });
        }

        return tx.formDefinition.create({
          data: {
            tenantId,
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            category: dto.category?.trim() || null,
            specialtyId: await this.resolveSpecialty(tx, tenantId, dto.specialtyCode),
            createdById: userId,
            versions: {
              create: {
                version: 1,
                schema: schema as unknown as Prisma.InputJsonValue,
                createdById: userId,
              },
            },
          },
          include: definitionInclude,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }

  /**
   * Name, description, category, specialty and status change in place. The schema never
   * does: a different one is added as the next version and the earlier ones stay as they are.
   */
  async update(tenantId: string, formId: string, userId: string, dto: UpdateFormDefinitionDto) {
    const schema = dto.schema == null ? undefined : validateFormSchema(dto.schema);

    try {
      return await this.transaction(async (tx) => {
        const form = await tx.formDefinition.findFirst({
          where: { id: formId, tenantId },
          include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
        });
        if (!form) throw new NotFoundException('Formulario no encontrado');

        const changesSchema =
          schema !== undefined && canonical(schema) !== canonical(form.versions[0]?.schema);
        const nextVersion = form.currentVersion + 1;

        return tx.formDefinition.update({
          where: { id: formId },
          data: {
            ...(typeof dto.name === 'string' ? { name: dto.name.trim() } : {}),
            ...(dto.description !== undefined
              ? { description: dto.description?.trim() || null }
              : {}),
            ...(dto.category !== undefined ? { category: dto.category?.trim() || null } : {}),
            ...(dto.specialtyCode !== undefined
              ? { specialtyId: await this.resolveSpecialty(tx, tenantId, dto.specialtyCode) }
              : {}),
            ...(typeof dto.isActive === 'boolean' ? { isActive: dto.isActive } : {}),
            ...(changesSchema
              ? {
                  currentVersion: nextVersion,
                  versions: {
                    create: {
                      version: nextVersion,
                      schema: schema as unknown as Prisma.InputJsonValue,
                      createdById: userId,
                    },
                  },
                }
              : {}),
          },
          include: definitionInclude,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Either the new name is taken or a concurrent edit already created this version.
        const target = (error as Prisma.PrismaClientKnownRequestError).meta?.target;
        if (JSON.stringify(target ?? '').includes('version')) {
          throw new ConflictException({
            statusCode: 409,
            code: 'FORM_VERSION_CONFLICT',
            message: 'El formulario cambió mientras lo editabas. Vuelve a cargarlo.',
          });
        }
        throw nameTaken();
      }
      throw error;
    }
  }

  private async resolveSpecialty(
    tx: Prisma.TransactionClient,
    tenantId: string,
    specialtyCode?: string | null,
  ): Promise<string | null> {
    const code = specialtyCode?.trim().toUpperCase();
    if (!code) return null;

    const specialty = await tx.specialty.findFirst({
      where: { code, isActive: true, tenants: { some: { tenantId } } },
      select: { id: true },
    });
    if (!specialty) {
      throw new ConflictException({
        statusCode: 409,
        code: 'SPECIALTY_NOT_ENABLED',
        message: 'La especialidad no está habilitada para este consultorio.',
      });
    }
    return specialty.id;
  }

  private transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.applyRlsContext(tx);
      return callback(tx);
    });
  }
}
