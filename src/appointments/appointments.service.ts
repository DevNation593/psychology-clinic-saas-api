import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAppointmentDto, UpdateAppointmentDto } from './dto/appointment.dto';

@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create appointment with conflict detection
   */
  async create(tenantId: string, createAppointmentDto: CreateAppointmentDto) {
    const { startTime, duration, psychologistId, patientId, ...appointmentData } =
      createAppointmentDto;

    const start = new Date(startTime);
    const end = new Date(start.getTime() + duration * 60000);

    // Validate dates
    if (isNaN(start.getTime())) {
      throw new BadRequestException('Invalid start time');
    }

    if (start < new Date()) {
      throw new BadRequestException('Cannot create appointments in the past');
    }

    // Verify patient belongs to tenant
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    // Verify psychologist belongs to tenant
    const psychologist = await this.prisma.user.findFirst({
      where: { id: psychologistId, tenantId, role: 'PSYCHOLOGIST', isActive: true },
    });

    if (!psychologist) {
      throw new NotFoundException('Psychologist not found or not authorized');
    }

    // Get tenant settings for working hours validation
    const settings = await this.prisma.tenantSettings.findUnique({
      where: { tenantId },
    });

    // Validate working hours
    if (settings) {
      const dayOfWeek = start.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
      if (!settings.workingDays.includes(dayOfWeek)) {
        throw new BadRequestException(
          `Appointments cannot be scheduled on ${dayOfWeek}. Working days: ${settings.workingDays.join(', ')}`,
        );
      }

      const startHour = start.getHours() * 60 + start.getMinutes();
      const [workStartHour, workStartMin] = settings.workingHoursStart.split(':').map(Number);
      const [workEndHour, workEndMin] = settings.workingHoursEnd.split(':').map(Number);
      const workStart = workStartHour * 60 + workStartMin;
      const workEnd = workEndHour * 60 + workEndMin;

      if (startHour < workStart || startHour >= workEnd) {
        throw new BadRequestException(
          `Appointments must be within working hours: ${settings.workingHoursStart} - ${settings.workingHoursEnd}`,
        );
      }
    }

    // CONFLICT DETECTION: Check for overlapping appointments
    await this.checkConflicts(tenantId, psychologistId, start, end, null);

    // Create appointment
    const appointment = await this.prisma.appointment.create({
      data: {
        ...appointmentData,
        tenantId,
        patientId,
        psychologistId,
        startTime: start,
        endTime: end,
        duration,
        status: 'SCHEDULED',
      },
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        psychologist: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    return appointment;
  }

  /**
   * Check for appointment conflicts (overlapping times for the same psychologist)
   */
  private async checkConflicts(
    tenantId: string,
    psychologistId: string,
    startTime: Date,
    endTime: Date,
    excludeAppointmentId: string | null,
  ) {
    const where: any = {
      tenantId,
      psychologistId,
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      OR: [
        // New appointment starts during existing appointment
        {
          startTime: { lte: startTime },
          endTime: { gt: startTime },
        },
        // New appointment ends during existing appointment
        {
          startTime: { lt: endTime },
          endTime: { gte: endTime },
        },
        // New appointment completely contains existing appointment
        {
          startTime: { gte: startTime },
          endTime: { lte: endTime },
        },
      ],
    };

    if (excludeAppointmentId) {
      where.id = { not: excludeAppointmentId };
    }

    const conflicts = await this.prisma.appointment.findMany({
      where,
      include: {
        patient: { select: { firstName: true, lastName: true } },
      },
    });

    if (conflicts.length > 0) {
      const conflictDetails = conflicts.map((a) => ({
        id: a.id,
        patient: `${a.patient.firstName} ${a.patient.lastName}`,
        startTime: a.startTime,
        endTime: a.endTime,
      }));

      throw new ConflictException({
        statusCode: 409,
        error: 'APPOINTMENT_CONFLICT',
        message: 'This time slot conflicts with existing appointment(s)',
        conflicts: conflictDetails,
      });
    }
  }

  async findAll(tenantId: string, filters?: { psychologistId?: string; patientId?: string; status?: string; from?: string; to?: string }) {
    const where: any = { tenantId };

    if (filters?.psychologistId) {
      where.psychologistId = filters.psychologistId;
    }

    if (filters?.patientId) {
      where.patientId = filters.patientId;
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.from || filters?.to) {
      where.startTime = {};
      if (filters.from) {
        where.startTime.gte = new Date(filters.from);
      }
      if (filters.to) {
        where.startTime.lte = new Date(filters.to);
      }
    }

    const appointments = await this.prisma.appointment.findMany({
      where,
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
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
      orderBy: { startTime: 'asc' },
    });

    return appointments;
  }

  async findOne(tenantId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
      include: {
        patient: true,
        psychologist: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        clinicalNotes: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    return appointment;
  }

  async update(tenantId: string, appointmentId: string, updateAppointmentDto: UpdateAppointmentDto) {
    const existing = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
    });

    if (!existing) {
      throw new NotFoundException('Appointment not found');
    }

    // If updating time, check conflicts
    if (updateAppointmentDto.startTime || updateAppointmentDto.duration) {
      const newStart = updateAppointmentDto.startTime
        ? new Date(updateAppointmentDto.startTime)
        : existing.startTime;
      const newDuration = updateAppointmentDto.duration || existing.duration;
      const newEnd = new Date(newStart.getTime() + newDuration * 60000);

      await this.checkConflicts(
        tenantId,
        updateAppointmentDto.psychologistId || existing.psychologistId,
        newStart,
        newEnd,
        appointmentId,
      );

      updateAppointmentDto['endTime'] = newEnd;
    }

    const { patientId, psychologistId, status, ...dataToUpdate } = updateAppointmentDto;

    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        ...dataToUpdate,
        ...(status && { status: status as any }),
        ...(patientId && { patient: { connect: { id: patientId } } }),
        ...(psychologistId && { psychologist: { connect: { id: psychologistId } } }),
      },
      include: {
        patient: true,
        psychologist: true,
      },
    });
  }

  async cancel(tenantId: string, appointmentId: string, userId: string, reason: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancellationReason: reason,
      },
    });
  }

  /**
   * Find upcoming appointments that need reminders
   * Used by the reminder worker
   */
  async findAppointmentsNeedingReminders(hoursBeforeList: number[]) {
    const now = new Date();

    const appointments = await this.prisma.appointment.findMany({
      where: {
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        startTime: { gte: now },
      },
      include: {
        patient: true,
        psychologist: true,
        tenant: {
          include: { settings: true },
        },
      },
    });

    // Filter appointments that need reminders
    const needingReminders = [];

    for (const appointment of appointments) {
      const hoursUntil = (appointment.startTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      for (const hoursBefore of hoursBeforeList) {
        const shouldSend = hoursUntil <= hoursBefore && hoursUntil > hoursBefore - 0.5;

        // Check if already sent
        let alreadySent = false;
        if (hoursBefore === 24 && appointment.reminderSent24h) {
          alreadySent = true;
        }
        if (hoursBefore === 2 && appointment.reminderSent2h) {
          alreadySent = true;
        }

        if (shouldSend && !alreadySent) {
          needingReminders.push({
            appointment,
            hoursBefore,
          });
        }
      }
    }

    return needingReminders;
  }

  async markReminderSent(appointmentId: string, hoursBefore: number) {
    const updates: any = { lastReminderSentAt: new Date() };

    if (hoursBefore === 24) {
      updates.reminderSent24h = true;
    } else if (hoursBefore === 2) {
      updates.reminderSent2h = true;
    }

    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: updates,
    });
  }
}
