import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SpecialtyRecord } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicalActor } from '../clinical-access/clinical-actor';
import { ClinicalCipher } from '../clinical-access/clinical-cipher';
import { ClinicalAuditService } from '../clinical-access/clinical-audit.service';
import { ClinicalCryptoService } from '../clinical-access/clinical-crypto.service';
import { clinicalRecordForbidden } from '../clinical-access/clinical-errors';
import { CreateSpecialtyRecordDto } from './dto/create-specialty-record.dto';

const MODULE_FIELDS: Record<string, string[]> = {
  'psychology.assessments': ['testName', 'score', 'interpretation'],
  'nutrition.assessments': ['weightKg', 'heightCm', 'bmi'],
  'nutrition.diet-plans': ['dailyCalories', 'meals', 'dietaryGoals'],
  'physiotherapy.evolution': ['painLevel', 'mobility', 'progress'],
  'physiotherapy.exercise-plans': ['exercises', 'frequency', 'repetitions'],
  'dentistry.treatments': ['procedure', 'tooth', 'treatmentStatus'],
  'dentistry.odontogram': ['findings', 'surfaces'],
};

/** The clinical state of a record, stored in the audit log with every change. */
export function snapshotSpecialtyRecord(record: SpecialtyRecord) {
  return {
    version: record.version,
    patientId: record.patientId,
    professionalId: record.professionalId,
    specialtyId: record.specialtyId,
    moduleKey: record.moduleKey,
    appointmentId: record.appointmentId,
    recordDate: record.recordDate,
    data: record.data,
    notes: record.notes,
  };
}

/** `data` and `notes` are stored encrypted; callers always receive the decrypted record. */
export function decryptSpecialtyRecord<T extends SpecialtyRecord>(
  cipher: ClinicalCipher,
  record: T,
): T {
  return {
    ...record,
    data: cipher.decryptJson(record.tenantId, record.data),
    notes: record.notes === null ? null : cipher.decrypt(record.tenantId, record.notes),
  };
}

@Injectable()
export class SpecialtyRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: ClinicalAuditService,
    private readonly crypto: ClinicalCryptoService,
  ) {}

  async list(tenantId: string, patientId: string, actor: ClinicalActor, moduleKey?: string) {
    await this.assertPatient(tenantId, patientId);
    const stored = await this.prisma.specialtyRecord.findMany({
      where: { tenantId, patientId, deletedAt: null, ...(moduleKey ? { moduleKey } : {}) },
      include: {
        specialty: { select: { code: true, name: true } },
        professional: { select: { id: true, firstName: true, lastName: true } },
        appointment: { select: { id: true, title: true, startTime: true } },
      },
      orderBy: { recordDate: 'desc' },
    });
    const records = stored.map((record) => decryptSpecialtyRecord(this.crypto, record));

    await this.audit.record(
      tenantId,
      actor,
      records.map((record) => ({
        action: 'READ' as const,
        entity: 'SPECIALTY_RECORD' as const,
        entityId: record.id,
        patientId,
      })),
    );

    return records;
  }

  async create(
    tenantId: string,
    patientId: string,
    actor: ClinicalActor,
    dto: CreateSpecialtyRecordDto,
  ) {
    await this.assertPatient(tenantId, patientId);

    const specialty = await this.prisma.specialty.findFirst({
      where: {
        code: dto.specialtyCode.toUpperCase(),
        isActive: true,
        tenants: { some: { tenantId } },
      },
    });
    if (!specialty) {
      throw new BadRequestException('La especialidad no está habilitada para este tenant');
    }

    // The history is shared for reading, but each professional writes only under their own specialty.
    if (specialty.id !== actor.specialtyId) {
      throw clinicalRecordForbidden('Solo puedes crear registros de tu propia especialidad');
    }

    const module = await this.prisma.tenantModule.findFirst({
      where: { tenantId, moduleKey: dto.moduleKey, enabled: true },
    });
    if (!module) {
      throw new ForbiddenException('El módulo especializado no está habilitado');
    }

    const specialtyModule = await this.prisma.specialtyModule.findFirst({
      where: { specialtyId: specialty.id, moduleKey: dto.moduleKey },
    });
    if (!specialtyModule) {
      throw new BadRequestException('El módulo no corresponde a la especialidad seleccionada');
    }

    const missingFields = (MODULE_FIELDS[dto.moduleKey] || []).filter(
      (field) =>
        dto.data[field] === undefined || dto.data[field] === null || dto.data[field] === '',
    );
    if (missingFields.length > 0) {
      throw new BadRequestException(`Faltan campos: ${missingFields.join(', ')}`);
    }

    if (dto.appointmentId) {
      const appointment = await this.prisma.appointment.findFirst({
        where: { id: dto.appointmentId, tenantId, patientId },
      });
      if (!appointment) {
        throw new BadRequestException('La cita no pertenece al paciente o tenant');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await this.prisma.applyRlsContext(tx);

      const stored = await tx.specialtyRecord.create({
        data: {
          tenantId,
          patientId,
          professionalId: actor.userId,
          specialtyId: specialty.id,
          moduleKey: dto.moduleKey,
          appointmentId: dto.appointmentId,
          recordDate: dto.recordDate ? new Date(dto.recordDate) : undefined,
          data: this.crypto.encryptJson(tenantId, dto.data) as Prisma.InputJsonValue,
          notes: dto.notes === undefined ? undefined : this.crypto.encrypt(tenantId, dto.notes),
        },
        include: {
          specialty: { select: { code: true, name: true } },
          professional: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      const record = decryptSpecialtyRecord(this.crypto, stored);

      await this.audit.record(
        tenantId,
        actor,
        [
          {
            action: 'CREATE',
            entity: 'SPECIALTY_RECORD',
            entityId: record.id,
            patientId,
            after: snapshotSpecialtyRecord(record),
          },
        ],
        tx,
      );

      return record;
    });
  }

  private async assertPatient(tenantId: string, patientId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) {
      throw new NotFoundException('Paciente no encontrado');
    }
  }
}
