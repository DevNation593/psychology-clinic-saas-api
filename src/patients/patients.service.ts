import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PatientTeamService } from '../patient-team/patient-team.service';
import { CreatePatientDto, UpdatePatientDto } from './dto/patient.dto';

@Injectable()
export class PatientsService {
  constructor(
    private prisma: PrismaService,
    private patientTeam: PatientTeamService,
  ) {}

  private normalizeOptionalString(value?: string | null): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeDateOfBirth(value?: string): Date | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    // HTML date inputs send YYYY-MM-DD; Prisma DateTime expects a Date instance or full ISO datetime.
    return new Date(`${trimmed}T00:00:00.000Z`);
  }

  private sanitizeCreatePayload(createPatientDto: CreatePatientDto) {
    return {
      ...createPatientDto,
      dateOfBirth: this.normalizeDateOfBirth(createPatientDto.dateOfBirth),
      email: this.normalizeOptionalString(createPatientDto.email),
      phone: this.normalizeOptionalString(createPatientDto.phone),
      gender: this.normalizeOptionalString(createPatientDto.gender),
      address: this.normalizeOptionalString(createPatientDto.address),
      emergencyContact: this.normalizeOptionalString(createPatientDto.emergencyContact),
      emergencyPhone: this.normalizeOptionalString(createPatientDto.emergencyPhone),
      emergencyContactName: this.normalizeOptionalString(createPatientDto.emergencyContactName),
      emergencyContactPhone: this.normalizeOptionalString(createPatientDto.emergencyContactPhone),
      assignedPsychologistId: this.normalizeOptionalString(createPatientDto.assignedPsychologistId),
      allergies: this.normalizeOptionalString(createPatientDto.allergies),
      currentMedication: this.normalizeOptionalString(createPatientDto.currentMedication),
      notes: this.normalizeOptionalString(createPatientDto.notes),
    };
  }

  private sanitizeUpdatePayload(updatePatientDto: UpdatePatientDto) {
    return {
      ...updatePatientDto,
      dateOfBirth: this.normalizeDateOfBirth(updatePatientDto.dateOfBirth),
      email: this.normalizeOptionalString(updatePatientDto.email),
      phone: this.normalizeOptionalString(updatePatientDto.phone),
      gender: this.normalizeOptionalString(updatePatientDto.gender),
      address: this.normalizeOptionalString(updatePatientDto.address),
      emergencyContact: this.normalizeOptionalString(updatePatientDto.emergencyContact),
      emergencyPhone: this.normalizeOptionalString(updatePatientDto.emergencyPhone),
      emergencyContactName: this.normalizeOptionalString(updatePatientDto.emergencyContactName),
      emergencyContactPhone: this.normalizeOptionalString(updatePatientDto.emergencyContactPhone),
      assignedPsychologistId: this.normalizeOptionalString(updatePatientDto.assignedPsychologistId),
      allergies: this.normalizeOptionalString(updatePatientDto.allergies),
      currentMedication: this.normalizeOptionalString(updatePatientDto.currentMedication),
      notes: this.normalizeOptionalString(updatePatientDto.notes),
    };
  }

  async create(
    tenantId: string,
    createPatientDto: CreatePatientDto,
    currentUserId: string,
    currentUserRole: string,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.prisma.applyRlsContext(tx, {
          tenantId,
          userId: currentUserId,
          role: currentUserRole,
        });

        let subscription = await tx.tenantSubscription.findUnique({
          where: { tenantId },
        });

        // Some RLS policies only allow admins to read subscription details.
        if (!subscription && currentUserRole !== 'CLIENTE') {
          await this.prisma.applyRlsContext(tx, {
            tenantId,
            userId: currentUserId,
            role: 'CLIENTE',
          });
          subscription = await tx.tenantSubscription.findUnique({
            where: { tenantId },
          });

          // Restore effective caller context before patient write.
          await this.prisma.applyRlsContext(tx, {
            tenantId,
            userId: currentUserId,
            role: currentUserRole,
          });
        }

        this.assertCanCreatePatient(tenantId, subscription);

        const sanitized = this.sanitizeCreatePayload(createPatientDto);
        const assignedPsychologistId = sanitized.assignedPsychologistId;
        const patient = await tx.patient.create({
          data: {
            ...sanitized,
            tenantId,
          },
        });

        if (assignedPsychologistId) {
          await this.patientTeam.ensureActive(tx, {
            tenantId,
            patientId: patient.id,
            professionalId: assignedPsychologistId,
            assignedById: currentUserId,
          });
        }

        // Maintain usage counters; if RLS blocks this for non-admin roles, retry under admin context.
        let updated = await tx.tenantSubscription.updateMany({
          where: {
            tenantId,
            activePatientsCount: { lt: subscription.maxActivePatients },
          },
          data: { activePatientsCount: { increment: 1 } },
        });

        if (updated.count === 0 && currentUserRole !== 'CLIENTE') {
          await this.prisma.applyRlsContext(tx, {
            tenantId,
            userId: currentUserId,
            role: 'CLIENTE',
          });
          updated = await tx.tenantSubscription.updateMany({
            where: {
              tenantId,
              activePatientsCount: { lt: subscription.maxActivePatients },
            },
            data: { activePatientsCount: { increment: 1 } },
          });
        }

        if (updated.count === 0) {
          throw new ForbiddenException({
            error: 'PATIENT_LIMIT_REACHED',
            message: `Límite de pacientes alcanzado. El plan actual (${subscription.planType}) permite ${subscription.maxActivePatients} paciente(s) activo(s). Por favor actualiza tu plan.`,
            details: {
              maxActivePatients: subscription.maxActivePatients,
              activePatientsCount: subscription.activePatientsCount,
              planType: subscription.planType,
              upgradeUrl: `/tenants/${tenantId}/subscription/upgrade`,
            },
          });
        }

        return patient;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private assertCanCreatePatient(tenantId: string, subscription: any) {
    if (!subscription) {
      throw new ForbiddenException('No se encontró suscripción para esta clínica');
    }

    // Check subscription status
    if (subscription.status !== 'ACTIVE' && subscription.status !== 'TRIALING') {
      throw new ForbiddenException({
        error: 'SUBSCRIPTION_INACTIVE',
        message: 'No se pueden crear pacientes. Tu suscripción no está activa.',
        status: subscription.status,
      });
    }

    // Check patient limit
    if (subscription.activePatientsCount >= subscription.maxActivePatients) {
      throw new ForbiddenException({
        error: 'PATIENT_LIMIT_REACHED',
        message: `Límite de pacientes alcanzado. El plan actual (${subscription.planType}) permite ${subscription.maxActivePatients} paciente(s) activo(s). Por favor actualiza tu plan.`,
        details: {
          maxActivePatients: subscription.maxActivePatients,
          activePatientsCount: subscription.activePatientsCount,
          planType: subscription.planType,
          upgradeUrl: `/tenants/${tenantId}/subscription/upgrade`,
        },
      });
    }
  }

  async findAll(tenantId: string, search?: string) {
    const where: any = {
      tenantId,
      isActive: true,
      deletedAt: null,
    };

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const patients = await this.prisma.patient.findMany({
      where,
      orderBy: { lastName: 'asc' },
      include: {
        assignedPsychologist: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true,
            role: true,
          },
        },
      },
    });

    return patients;
  }

  async findOne(tenantId: string, patientId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: {
        id: patientId,
        tenantId,
        deletedAt: null,
      },
      include: {
        assignedPsychologist: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            avatarUrl: true,
            role: true,
          },
        },
        appointments: {
          where: { status: { not: 'CANCELLED' } },
          orderBy: { startTime: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            appointments: true,
            clinicalNotes: true,
            tasks: true,
          },
        },
      },
    });

    if (!patient) {
      throw new NotFoundException('Paciente no encontrado');
    }

    return patient;
  }

  async update(
    tenantId: string,
    patientId: string,
    updatePatientDto: UpdatePatientDto,
    currentUserId: string,
    currentUserRole: string,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.prisma.applyRlsContext(tx, {
          tenantId,
          userId: currentUserId,
          role: currentUserRole,
        });

        const patient = await tx.patient.findFirst({
          where: { id: patientId, tenantId, deletedAt: null },
        });

        if (!patient) {
          throw new NotFoundException('Paciente no encontrado');
        }

        const { assignedPsychologistId, ...otherData } =
          this.sanitizeUpdatePayload(updatePatientDto);
        const updated = await tx.patient.update({
          where: { id: patientId },
          data: {
            ...otherData,
            ...(assignedPsychologistId !== undefined ? { assignedPsychologistId } : {}),
          },
        });

        if (assignedPsychologistId) {
          await this.patientTeam.ensureActive(tx, {
            tenantId,
            patientId,
            professionalId: assignedPsychologistId,
            assignedById: currentUserId,
          });
        }

        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async softDelete(
    tenantId: string,
    patientId: string,
    currentUserId: string,
    currentUserRole: string,
  ) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId },
    });

    if (!patient) {
      throw new NotFoundException('Paciente no encontrado');
    }

    if (!patient.isActive || patient.deletedAt) {
      return { success: true, message: 'El paciente ya está desactivado' };
    }

    // Update patient and decrement counter in a transaction
    await this.prisma.$transaction(async (tx) => {
      await this.prisma.applyRlsContext(tx, {
        tenantId,
        userId: currentUserId,
        role: currentUserRole,
      });

      await tx.patient.update({
        where: { id: patientId },
        data: {
          isActive: false,
          deletedAt: new Date(),
        },
      });

      let subscription = await tx.tenantSubscription.findUnique({ where: { tenantId } });

      if (!subscription && currentUserRole !== 'CLIENTE') {
        await this.prisma.applyRlsContext(tx, {
          tenantId,
          userId: currentUserId,
          role: 'CLIENTE',
        });
        subscription = await tx.tenantSubscription.findUnique({ where: { tenantId } });
      }

      if (subscription && subscription.activePatientsCount > 0) {
        await tx.tenantSubscription.updateMany({
          where: {
            tenantId,
            activePatientsCount: { gt: 0 },
          },
          data: { activePatientsCount: { decrement: 1 } },
        });
      }
    });

    return { success: true, message: 'Patient deactivated successfully' };
  }
}
