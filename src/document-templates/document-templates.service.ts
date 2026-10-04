import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDocumentTemplateDto, UpdateDocumentTemplateDto } from './dto/document-template.dto';
import { TEMPLATE_VARIABLES } from './template-catalog';

export const MAX_TEMPLATES_PER_TENANT = 200;

const VARIABLE_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** The variables a text uses that no client knows how to fill in. */
export function unknownTemplateVariables(text: string): string[] {
  const unknown = new Set<string>();
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(match[1])) unknown.add(match[1]);
  }
  return [...unknown];
}

const isUniqueViolation = (error: unknown) =>
  (error as Prisma.PrismaClientKnownRequestError)?.code === 'P2002';

const nameTaken = () =>
  new ConflictException({
    statusCode: 409,
    code: 'TEMPLATE_NAME_TAKEN',
    message: 'Ya existe una plantilla con ese nombre para este tipo de documento.',
  });

const clean = (value?: string | null) => value?.trim() || null;

@Injectable()
export class DocumentTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Templates of the clinic. `activeOnly` is what a professional writing a document sees. */
  list(tenantId: string, filter: { moduleKey?: string; activeOnly?: boolean } = {}) {
    return this.prisma.documentTemplate.findMany({
      where: {
        tenantId,
        ...(filter.moduleKey ? { moduleKey: filter.moduleKey } : {}),
        ...(filter.activeOnly ? { isActive: true } : {}),
      },
      orderBy: [{ moduleKey: 'asc' }, { name: 'asc' }],
    });
  }

  async create(tenantId: string, actorId: string, dto: CreateDocumentTemplateDto) {
    this.assertVariables(dto.title, dto.body);
    const count = await this.prisma.documentTemplate.count({ where: { tenantId } });
    if (count >= MAX_TEMPLATES_PER_TENANT) {
      throw new ConflictException({
        statusCode: 409,
        code: 'TEMPLATE_LIMIT_REACHED',
        message: `El consultorio admite hasta ${MAX_TEMPLATES_PER_TENANT} plantillas.`,
      });
    }

    try {
      return await this.prisma.documentTemplate.create({
        data: {
          tenantId,
          moduleKey: dto.moduleKey,
          name: dto.name.trim(),
          title: clean(dto.title),
          body: dto.body.trim(),
          createdById: actorId,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }

  async update(tenantId: string, templateId: string, dto: UpdateDocumentTemplateDto) {
    const template = await this.prisma.documentTemplate.findFirst({
      where: { id: templateId, tenantId },
    });
    if (!template) throw new NotFoundException('Plantilla no encontrada');
    this.assertVariables(dto.title, dto.body);

    try {
      return await this.prisma.documentTemplate.update({
        where: { id: templateId },
        data: {
          ...(typeof dto.name === 'string' ? { name: dto.name.trim() } : {}),
          ...(dto.title !== undefined ? { title: clean(dto.title) } : {}),
          ...(typeof dto.body === 'string' ? { body: dto.body.trim() } : {}),
          ...(typeof dto.isActive === 'boolean' ? { isActive: dto.isActive } : {}),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }

  /** A variable nobody fills in would reach the patient as `{{...}}` in a signed document. */
  private assertVariables(...texts: (string | null | undefined)[]) {
    const unknown = unknownTemplateVariables(texts.filter(Boolean).join('\n'));
    if (unknown.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'TEMPLATE_VARIABLE_UNKNOWN',
        message: `Variables no reconocidas: ${unknown.map((name) => `{{${name}}}`).join(', ')}. Las disponibles son ${TEMPLATE_VARIABLES.map((name) => `{{${name}}}`).join(', ')}.`,
        variables: unknown,
      });
    }
  }
}
