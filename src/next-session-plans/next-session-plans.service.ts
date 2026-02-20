import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNextSessionPlanDto, UpdateNextSessionPlanDto } from './dto/next-session-plan.dto';

@Injectable()
export class NextSessionPlansService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, psychologistId: string, createDto: CreateNextSessionPlanDto) {
    const { patientId, ...planData } = createDto;

    // Verify patient belongs to tenant
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    // Check if plan already exists for this patient
    const existing = await this.prisma.nextSessionPlan.findUnique({
      where: { patientId },
    });

    if (existing) {
      throw new ConflictException(
        'A session plan already exists for this patient. Use update instead.',
      );
    }

    const plan = await this.prisma.nextSessionPlan.create({
      data: {
        ...planData,
        tenantId,
        patientId,
        psychologistId,
      },
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        psychologist: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return plan;
  }

  async findByPatient(tenantId: string, patientId: string) {
    const plan = await this.prisma.nextSessionPlan.findFirst({
      where: { tenantId, patientId },
      include: {
        patient: true,
        psychologist: true,
      },
    });

    return plan;
  }

  async findAll(tenantId: string, psychologistId?: string) {
    const where: any = { tenantId };

    if (psychologistId) {
      where.psychologistId = psychologistId;
    }

    const plans = await this.prisma.nextSessionPlan.findMany({
      where,
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        psychologist: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return plans;
  }

  async update(
    tenantId: string,
    patientId: string,
    psychologistId: string,
    updateDto: UpdateNextSessionPlanDto,
  ) {
    const plan = await this.prisma.nextSessionPlan.findFirst({
      where: { tenantId, patientId },
    });

    if (!plan) {
      throw new NotFoundException('Session plan not found');
    }

    return this.prisma.nextSessionPlan.update({
      where: { id: plan.id },
      data: {
        ...updateDto,
        psychologistId, // Update psychologist if different
      },
      include: {
        patient: true,
        psychologist: true,
      },
    });
  }

  async delete(tenantId: string, patientId: string) {
    const plan = await this.prisma.nextSessionPlan.findFirst({
      where: { tenantId, patientId },
    });

    if (!plan) {
      throw new NotFoundException('Session plan not found');
    }

    await this.prisma.nextSessionPlan.delete({
      where: { id: plan.id },
    });

    return { message: 'Session plan deleted successfully' };
  }
}
