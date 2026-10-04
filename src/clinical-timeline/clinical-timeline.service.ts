import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicalActor } from '../clinical-access/clinical-actor';
import { ClinicalAuditService } from '../clinical-access/clinical-audit.service';
import { ClinicalCryptoService } from '../clinical-access/clinical-crypto.service';
import { ENCRYPTED_NOTE_FIELDS } from '../clinical-notes/clinical-notes.service';
import { decryptSpecialtyRecord } from '../specialty-records/specialty-records.service';
import { ClinicalTimelineQueryDto, TimelineEntryType } from './dto/clinical-timeline-query.dto';

const personSelect = { id: true, firstName: true, lastName: true } as const;
const specialtySelect = { id: true, code: true, name: true } as const;

type Person = { id: string; firstName: string; lastName: string };
type SpecialtyRef = { id: string; code: string; name: string };

export interface TimelineEntry {
  type: TimelineEntryType;
  id: string;
  date: Date;
  professional: Person | null;
  specialty: SpecialtyRef | null;
  record: unknown;
}

@Injectable()
export class ClinicalTimelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: ClinicalAuditService,
    private readonly crypto: ClinicalCryptoService,
  ) {}

  /** Appointments, notes and specialty records of one patient, newest first. */
  async getTimeline(
    tenantId: string,
    patientId: string,
    actor: ClinicalActor,
    query: ClinicalTimelineQueryDto,
  ): Promise<TimelineEntry[]> {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) {
      throw new NotFoundException('Paciente no encontrado');
    }

    const wants = (type: TimelineEntryType) => !query.type || query.type === type;
    const range =
      query.from || query.to
        ? {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          }
        : undefined;
    const specialty = query.specialtyId ? { specialtyId: query.specialtyId } : {};

    const [appointments, storedNotes, storedRecords] = await Promise.all([
      wants('APPOINTMENT')
        ? this.prisma.appointment.findMany({
            where: {
              tenantId,
              patientId,
              ...specialty,
              ...(query.professionalId
                ? {
                    OR: [
                      { professionalId: query.professionalId },
                      { professionalId: null, psychologistId: query.professionalId },
                    ],
                  }
                : {}),
              ...(range ? { startTime: range } : {}),
            },
            select: {
              id: true,
              title: true,
              startTime: true,
              endTime: true,
              status: true,
              professional: { select: personSelect },
              psychologist: { select: personSelect },
              specialty: { select: specialtySelect },
            },
          })
        : [],
      wants('CLINICAL_NOTE')
        ? this.prisma.clinicalNote.findMany({
            where: {
              tenantId,
              patientId,
              deletedAt: null,
              ...specialty,
              ...(query.professionalId ? { psychologistId: query.professionalId } : {}),
              ...(range ? { sessionDate: range } : {}),
            },
            include: {
              psychologist: { select: personSelect },
              specialty: { select: specialtySelect },
            },
          })
        : [],
      wants('SPECIALTY_RECORD')
        ? this.prisma.specialtyRecord.findMany({
            where: {
              tenantId,
              patientId,
              deletedAt: null,
              ...specialty,
              ...(query.professionalId ? { professionalId: query.professionalId } : {}),
              ...(range ? { recordDate: range } : {}),
            },
            include: {
              professional: { select: personSelect },
              specialty: { select: specialtySelect },
            },
          })
        : [],
    ]);
    const notes = storedNotes.map((note) =>
      this.crypto.decryptFields(tenantId, note, ENCRYPTED_NOTE_FIELDS),
    );
    const records = storedRecords.map((record) => decryptSpecialtyRecord(this.crypto, record));

    await this.audit.record(tenantId, actor, [
      ...notes.map((note) => ({
        action: 'READ' as const,
        entity: 'CLINICAL_NOTE' as const,
        entityId: note.id,
        patientId,
      })),
      ...records.map((record) => ({
        action: 'READ' as const,
        entity: 'SPECIALTY_RECORD' as const,
        entityId: record.id,
        patientId,
      })),
    ]);

    const entries: TimelineEntry[] = [
      ...appointments.map(({ professional, psychologist, specialty: spec, ...record }) => ({
        type: 'APPOINTMENT' as const,
        id: record.id,
        date: record.startTime,
        professional: professional ?? psychologist,
        specialty: spec,
        record,
      })),
      ...notes.map(({ psychologist, specialty: spec, ...record }) => ({
        type: 'CLINICAL_NOTE' as const,
        id: record.id,
        date: record.sessionDate,
        professional: psychologist,
        specialty: spec,
        record,
      })),
      ...records.map(({ professional, specialty: spec, ...record }) => ({
        type: 'SPECIALTY_RECORD' as const,
        id: record.id,
        date: record.recordDate,
        professional,
        specialty: spec,
        record,
      })),
    ];

    return entries.sort((a, b) => b.date.getTime() - a.date.getTime());
  }
}
