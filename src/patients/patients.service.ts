import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePatientDto, UpdatePatientDto } from './dto/patient.dto';

@Injectable()
export class PatientsService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, createPatientDto: CreatePatientDto) {
    // Check patient limit
    await this.checkPatientLimit(tenantId);

    const patient = await this.prisma.patient.create({
      data: {
        ...createPatientDto,
        tenantId,
      },
    });

    // Increment active patients count
    await this.prisma.tenantSubscription.update({
      where: { tenantId },
      data: { activePatientsCount: { increment: 1 } },
    });

    return patient;
  }

  private async checkPatientLimit(tenantId: string) {
    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });

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
      data: updatePatientDto,
    });
  }

  async softDelete(tenantId: string, patientId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    // Update patient and decrement counter in a transaction
    await this.prisma.$transaction([
      this.prisma.patient.update({
        where: { id: patientId },
        data: {
          isActive: false,
          deletedAt: new Date(),
        },
      }),
      this.prisma.tenantSubscription.update({
        where: { tenantId },
        data: { activePatientsCount: { decrement: 1 } },
      }),
    ]);

    return { success: true, message: 'Patient deactivated successfully' };
  }
}
