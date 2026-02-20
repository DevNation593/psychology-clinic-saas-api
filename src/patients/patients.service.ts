import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePatientDto, UpdatePatientDto } from './dto/patient.dto';

@Injectable()
export class PatientsService {
  constructor(private prisma: PrismaService) {}

  private normalizeOptionalString(value?: string): string | null | undefined {
    if (value === undefined) {
      return undefined;
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
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.applyRlsContext(tx, {
        tenantId,
        userId: currentUserId,
        role: currentUserRole,
      });

      let subscription = await tx.tenantSubscription.findUnique({
        where: { tenantId },
      });

      // Some RLS policies only allow admins to read subscription details.
      if (!subscription && currentUserRole !== 'TENANT_ADMIN') {
        await this.prisma.applyRlsContext(tx, {
          tenantId,
          userId: currentUserId,
          role: 'TENANT_ADMIN',
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

      const patient = await tx.patient.create({
        data: {
          ...this.sanitizeCreatePayload(createPatientDto),
          tenantId,
        },
      });

      // Maintain usage counters; if RLS blocks this for non-admin roles, retry under admin context.
      let updated = await tx.tenantSubscription.updateMany({
        where: {
          tenantId,
          activePatientsCount: { lt: subscription.maxActivePatients },
        },
        data: { activePatientsCount: { increment: 1 } },
      });

      if (updated.count === 0 && currentUserRole !== 'TENANT_ADMIN') {
        await this.prisma.applyRlsContext(tx, {
          tenantId,
          userId: currentUserId,
          role: 'TENANT_ADMIN',
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
          message: `Patient limit reached. Current plan (${subscription.planType}) allows ${subscription.maxActivePatients} active patient(s). Please upgrade your plan.`,
          details: {
            maxActivePatients: subscription.maxActivePatients,
            activePatientsCount: subscription.activePatientsCount,
            planType: subscription.planType,
            upgradeUrl: `/tenants/${tenantId}/subscription/upgrade`,
          },
        });
      }

      return patient;
    });
  }

  private assertCanCreatePatient(tenantId: string, subscription: any) {
    if (!subscription) {
      throw new ForbiddenException('No subscription found for this tenant');
    }

    // Check subscription status
    if (subscription.status !== 'ACTIVE' && subscription.status !== 'TRIALING') {
      throw new ForbiddenException({
        error: 'SUBSCRIPTION_INACTIVE',
        message: 'Cannot create patients. Your subscription is not active.',
        status: subscription.status,
      });
    }

    // Check patient limit
    if (subscription.activePatientsCount >= subscription.maxActivePatients) {
      throw new ForbiddenException({
        error: 'PATIENT_LIMIT_REACHED',
        message: `Patient limit reached. Current plan (${subscription.planType}) allows ${subscription.maxActivePatients} active patient(s). Please upgrade your plan.`,
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
      throw new NotFoundException('Patient not found');
    }

    return patient;
  }

  async update(tenantId: string, patientId: string, updatePatientDto: UpdatePatientDto) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId, deletedAt: null },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    return this.prisma.patient.update({
      where: { id: patientId },
      data: this.sanitizeUpdatePayload(updatePatientDto),
    });
  }

  async softDelete(tenantId: string, patientId: string, currentUserId: string, currentUserRole: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    if (!patient.isActive || patient.deletedAt) {
      return { success: true, message: 'Patient already deactivated' };
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

      if (!subscription && currentUserRole !== 'TENANT_ADMIN') {
        await this.prisma.applyRlsContext(tx, {
          tenantId,
          userId: currentUserId,
          role: 'TENANT_ADMIN',
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
