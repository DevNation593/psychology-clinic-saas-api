import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClinicalNoteDto, UpdateClinicalNoteDto } from './dto/clinical-note.dto';

@Injectable()
export class ClinicalNotesService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, psychologistId: string, createDto: CreateClinicalNoteDto) {
    const { patientId, appointmentId, sessionDate, ...noteData } = createDto;

    // Verify patient belongs to tenant
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    // If appointmentId provided, verify it exists and belongs to this psychologist
    if (appointmentId) {
      const appointment = await this.prisma.appointment.findFirst({
        where: {
          id: appointmentId,
          tenantId,
          patientId,
          psychologistId,
        },
      });

      if (!appointment) {
        throw new NotFoundException('Appointment not found or not authorized');
      }
    }

    const note = await this.prisma.clinicalNote.create({
      data: {
        ...noteData,
        tenantId,
        patientId,
        appointmentId,
        psychologistId,
        sessionDate: sessionDate ? new Date(sessionDate) : new Date(),
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

    // Create audit log entry
    await this.createAuditLog(tenantId, psychologistId, 'CREATE', note.id);

    return note;
  }

  async findAll(
    tenantId: string,
    filters?: { patientId?: string; psychologistId?: string },
    userId?: string,
    userRole?: string,
  ) {
    const where: any = { tenantId };

    // Psychologists can only list their own notes.
    if (userRole === 'PSYCHOLOGIST') {
      where.psychologistId = userId;
    }

    if (filters?.patientId) {
      where.patientId = filters.patientId;
    }

    if (filters?.psychologistId && userRole !== 'PSYCHOLOGIST') {
      where.psychologistId = filters.psychologistId;
    }

    const notes = await this.prisma.clinicalNote.findMany({
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
      orderBy: { sessionDate: 'desc' },
    });

    return notes;
  }

  async findOne(tenantId: string, noteId: string, userId: string, userRole: string) {
    const note = await this.prisma.clinicalNote.findFirst({
      where: { id: noteId, tenantId },
      include: {
        patient: true,
        psychologist: true,
        appointment: true,
      },
    });

    if (!note) {
      throw new NotFoundException('Clinical note not found');
    }

    // Only the psychologist who created it or TENANT_ADMIN can read
    if (userRole !== 'TENANT_ADMIN' && note.psychologistId !== userId) {
      throw new ForbiddenException('You can only access your own clinical notes');
    }

    // Create audit log entry for reading
    await this.createAuditLog(tenantId, userId, 'READ', noteId);

    return note;
  }

  async update(
    tenantId: string,
    noteId: string,
    userId: string,
    userRole: string,
    updateDto: UpdateClinicalNoteDto,
  ) {
    const note = await this.prisma.clinicalNote.findFirst({
      where: { id: noteId, tenantId },
    });

    if (!note) {
      throw new NotFoundException('Clinical note not found');
    }

    // Only the psychologist who created it can edit
    if (note.psychologistId !== userId && userRole !== 'TENANT_ADMIN') {
      throw new ForbiddenException('You can only edit your own clinical notes');
    }

    const updated = await this.prisma.clinicalNote.update({
      where: { id: noteId },
      data: updateDto,
      include: {
        patient: true,
        psychologist: true,
      },
    });

    // Create audit log
    await this.createAuditLog(tenantId, userId, 'UPDATE', noteId, updateDto);

    return updated;
  }

  async delete(tenantId: string, noteId: string, userId: string, userRole: string) {
    const note = await this.prisma.clinicalNote.findFirst({
      where: { id: noteId, tenantId },
    });

    if (!note) {
      throw new NotFoundException('Clinical note not found');
    }

    // Only TENANT_ADMIN can delete
    if (userRole !== 'TENANT_ADMIN') {
      throw new ForbiddenException('Only administrators can delete clinical notes');
    }

    await this.prisma.clinicalNote.delete({
      where: { id: noteId },
    });

    // Create audit log
    await this.createAuditLog(tenantId, userId, 'DELETE', noteId);

    return { message: 'Clinical note deleted successfully' };
  }

  private async createAuditLog(
    tenantId: string,
    userId: string,
    action: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE',
    entityId: string,
    changes?: any,
  ) {
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action,
        entity: 'CLINICAL_NOTE',
        entityId,
        changes: changes || {},
      },
    });
  }
}
