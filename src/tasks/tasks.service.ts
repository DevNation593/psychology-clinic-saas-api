import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  private async assertAssignableUserBelongsToTenant(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, isActive: true },
    });

    if (!user) {
      throw new NotFoundException('Usuario asignado no encontrado en esta clínica');
    }
  }

  async create(tenantId: string, createdById: string, createTaskDto: CreateTaskDto) {
    const { patientId, dueDate, ...taskData } = createTaskDto;

    // Verify patient belongs to tenant
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId },
    });

    if (!patient) {
      throw new NotFoundException('Paciente no encontrado');
    }

    if (taskData.assignedToId) {
      await this.assertAssignableUserBelongsToTenant(tenantId, taskData.assignedToId);
    }

    const task = await this.prisma.task.create({
      data: {
        title: taskData.title,
        description: taskData.description,
        priority: taskData.priority as any,
        ...(taskData.assignedToId && {
          assignedTo: {
            connect: { id: taskData.assignedToId },
          },
        }),
        tenant: {
          connect: { id: tenantId },
        },
        patient: {
          connect: { id: patientId },
        },
        createdBy: {
          connect: { id: createdById },
        },
        dueDate: dueDate ? new Date(dueDate) : null,
      },
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return task;
  }

  async findAll(
    tenantId: string,
    filters?: {
      patientId?: string;
      assignedToId?: string;
      status?: string;
      priority?: string;
    },
  ) {
    const where: any = { tenantId };

    if (filters?.patientId) {
      where.patientId = filters.patientId;
    }

    if (filters?.assignedToId) {
      where.assignedToId = filters.assignedToId;
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.priority) {
      where.priority = filters.priority;
    }

    const tasks = await this.prisma.task.findMany({
      where,
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }],
    });

    return tasks;
  }

  async findOne(tenantId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, tenantId },
      include: {
        patient: true,
        createdBy: true,
        assignedTo: true,
      },
    });

    if (!task) {
      throw new NotFoundException('Tarea no encontrada');
    }

    return task;
  }

  async update(tenantId: string, taskId: string, updateTaskDto: UpdateTaskDto) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, tenantId },
    });

    if (!task) {
      throw new NotFoundException('Tarea no encontrada');
    }

    const updateData: any = { ...updateTaskDto };

    if (updateTaskDto.assignedToId) {
      await this.assertAssignableUserBelongsToTenant(tenantId, updateTaskDto.assignedToId);
    }

    // If marking as completed, set completedAt
    if (updateTaskDto.status === 'COMPLETED' && task.status !== 'COMPLETED') {
      updateData.completedAt = new Date();
    }

    return this.prisma.task.update({
      where: { id: taskId },
      data: updateData,
      include: {
        patient: true,
        createdBy: true,
        assignedTo: true,
      },
    });
  }

  async delete(tenantId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, tenantId },
    });

    if (!task) {
      throw new NotFoundException('Tarea no encontrada');
    }

    await this.prisma.task.delete({
      where: { id: taskId },
    });

    return { message: 'Tarea eliminada exitosamente' };
  }
}
