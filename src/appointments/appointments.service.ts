import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_USER_SELECT } from '../common/utils/public-user-select';
import { getZonedDateParts } from '../common/utils/timezone';
import { isAdminRole, isProfessionalRole } from '../common/roles/role-compatibility';
import { CreateAppointmentDto, UpdateAppointmentDto } from './dto/appointment.dto';

@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService) {}

  private async assertPatientBelongsToTenant(tenantId: string, patientId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId, deletedAt: null },
    });

    if (!patient) {
      throw new NotFoundException('Paciente no encontrado');
    }
  }

  private async assertPsychologistBelongsToTenant(tenantId: string, psychologistId: string) {
    const psychologist = await this.prisma.user.findFirst({
      where: {
        id: psychologistId,
        tenantId,
        role: { in: [UserRole.PSICOLOGO, UserRole.PROFESIONAL] },
        isActive: true,
      },
    });

    if (!psychologist) {
      throw new NotFoundException('Psicólogo no encontrado o no autorizado');
    }
  }

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
      throw new BadRequestException('Fecha de inicio inválida');
    }

    if (start < new Date()) {
      throw new BadRequestException('No se pueden crear citas en el pasado');
    }

    // Verify patient belongs to tenant
    await this.assertPatientBelongsToTenant(tenantId, patientId);

    // Verify psychologist belongs to tenant
    await this.assertPsychologistBelongsToTenant(tenantId, psychologistId);

    // Get tenant settings for working hours validation
    const settings = await this.prisma.tenantSettings.findUnique({
      where: { tenantId },
    });

    this.assertWithinWorkingHours(settings, start);

    // CONFLICT DETECTION: Check for overlapping appointments
    if (!settings?.allowDoubleBooking) {
      await this.checkConflicts(tenantId, psychologistId, start, end, null);
    }

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
   * Validate that an appointment starts on a working day and inside working hours,
   * evaluated in the tenant's own time zone (not the server's).
   */
  private assertWithinWorkingHours(
    settings: {
      workingDays: string[];
      workingHoursStart: string;
      workingHoursEnd: string;
      timezone?: string | null;
    } | null,
    start: Date,
  ) {
    if (!settings) {
      return;
    }

    const { dayOfWeek, minutesOfDay } = getZonedDateParts(start, settings.timezone);
    const dayLabels: Record<string, string> = {
      MONDAY: 'Lunes',
      TUESDAY: 'Martes',
      WEDNESDAY: 'Miércoles',
      THURSDAY: 'Jueves',
      FRIDAY: 'Viernes',
      SATURDAY: 'Sábado',
      SUNDAY: 'Domingo',
    };
    if (!settings.workingDays.includes(dayOfWeek)) {
      const workingDayLabels = settings.workingDays
        .map((d: string) => dayLabels[d] || d)
        .join(', ');
      throw new BadRequestException(
        `No se pueden programar citas el día ${dayLabels[dayOfWeek] || dayOfWeek}. Días laborales: ${workingDayLabels}`,
      );
    }

    const [workStartHour, workStartMin] = settings.workingHoursStart.split(':').map(Number);
    const [workEndHour, workEndMin] = settings.workingHoursEnd.split(':').map(Number);
    const workStart = workStartHour * 60 + workStartMin;
    const workEnd = workEndHour * 60 + workEndMin;

    if (minutesOfDay < workStart || minutesOfDay >= workEnd) {
      throw new BadRequestException(
        `Las citas deben estar dentro del horario laboral: ${settings.workingHoursStart} - ${settings.workingHoursEnd}`,
      );
    }
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
        message: 'Este horario tiene conflicto con cita(s) existente(s)',
        conflicts: conflictDetails,
      });
    }
  }

  async findAll(
    tenantId: string,
    filters?: {
      psychologistId?: string;
      patientId?: string;
      status?: string;
      from?: string;
      to?: string;
    },
  ) {
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

  async findOne(tenantId: string, appointmentId: string, userRole?: string) {
    // Clinical notes are only returned to roles allowed to read clinical records.
    const canReadClinicalNotes =
      !!userRole &&
      (isAdminRole(userRole) || isProfessionalRole(userRole) || userRole === 'SOPORTE');

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
        ...(canReadClinicalNotes && {
          clinicalNotes: {
            orderBy: { createdAt: 'desc' as const },
          },
        }),
      },
    });

    if (!appointment) {
      throw new NotFoundException('Cita no encontrada');
    }

    return appointment;
  }

  async update(
    tenantId: string,
    appointmentId: string,
    updateAppointmentDto: UpdateAppointmentDto,
  ) {
    const existing = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
    });

    if (!existing) {
      throw new NotFoundException('Cita no encontrada');
    }

    let rescheduled = false;

    // If the slot or the professional changes, validate it and check conflicts
    if (
      updateAppointmentDto.startTime ||
      updateAppointmentDto.duration ||
      updateAppointmentDto.psychologistId
    ) {
      const newStart = updateAppointmentDto.startTime
        ? new Date(updateAppointmentDto.startTime)
        : existing.startTime;

      if (isNaN(newStart.getTime())) {
        throw new BadRequestException('Fecha de inicio inválida');
      }

      const newDuration = updateAppointmentDto.duration || existing.duration;
      const newEnd = new Date(newStart.getTime() + newDuration * 60000);
      const newPsychologistId = updateAppointmentDto.psychologistId || existing.psychologistId;

      rescheduled = newStart.getTime() !== existing.startTime.getTime();
      const slotChanged =
        rescheduled ||
        newEnd.getTime() !== existing.endTime.getTime() ||
        newPsychologistId !== existing.psychologistId;

      const settings = await this.prisma.tenantSettings.findUnique({
        where: { tenantId },
      });

      // Only re-validate the schedule when the appointment is actually moved.
      if (rescheduled) {
        if (newStart < new Date()) {
          throw new BadRequestException('No se pueden mover citas al pasado');
        }
        this.assertWithinWorkingHours(settings, newStart);
      }

      if (slotChanged && !settings?.allowDoubleBooking) {
        await this.checkConflicts(tenantId, newPsychologistId, newStart, newEnd, appointmentId);
      }

      if (updateAppointmentDto.startTime || updateAppointmentDto.duration) {
        updateAppointmentDto['endTime'] = newEnd;
      }
    }

    if (updateAppointmentDto.patientId) {
      await this.assertPatientBelongsToTenant(tenantId, updateAppointmentDto.patientId);
    }

    if (updateAppointmentDto.psychologistId) {
      await this.assertPsychologistBelongsToTenant(tenantId, updateAppointmentDto.psychologistId);
    }

    const { patientId, psychologistId, status, ...dataToUpdate } = updateAppointmentDto;

    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        ...dataToUpdate,
        ...(status && { status: status as any }),
        // A moved appointment must be reminded again at its new time.
        ...(rescheduled && { reminderSent24h: false, reminderSent2h: false }),
        ...(patientId && { patient: { connect: { id: patientId } } }),
        ...(psychologistId && { psychologist: { connect: { id: psychologistId } } }),
      },
      include: {
        patient: true,
        psychologist: { select: PUBLIC_USER_SELECT },
      },
    });
  }

  async cancel(tenantId: string, appointmentId: string, userId: string, reason: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
    });

    if (!appointment) {
      throw new NotFoundException('Cita no encontrada');
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
        psychologist: { select: PUBLIC_USER_SELECT },
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
