import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

@Injectable()
export class SpecialtyRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, patientId: string, moduleKey?: string) {
    await this.assertPatient(tenantId, patientId);
    return this.prisma.specialtyRecord.findMany({
      where: { tenantId, patientId, ...(moduleKey ? { moduleKey } : {}) },
      include: {
        specialty: { select: { code: true, name: true } },
        professional: { select: { id: true, firstName: true, lastName: true } },
        appointment: { select: { id: true, title: true, startTime: true } },
      },
      orderBy: { recordDate: 'desc' },
    });
  }

  async create(
    tenantId: string,
    patientId: string,
    userId: string,
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

    const professional = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, isActive: true },
    });
    if (!professional) {
      throw new ForbiddenException('El profesional no pertenece al tenant');
    }

    const missingFields = (MODULE_FIELDS[dto.moduleKey] || []).filter(
      (field) => dto.data[field] === undefined || dto.data[field] === null || dto.data[field] === '',
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

    return this.prisma.specialtyRecord.create({
      data: {
        tenantId,
        patientId,
        professionalId: userId,
        specialtyId: specialty.id,
        moduleKey: dto.moduleKey,
        appointmentId: dto.appointmentId,
        recordDate: dto.recordDate ? new Date(dto.recordDate) : undefined,
        data: dto.data as Prisma.InputJsonValue,
        notes: dto.notes,
      },
      include: {
        specialty: { select: { code: true, name: true } },
        professional: { select: { id: true, firstName: true, lastName: true } },
      },
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
